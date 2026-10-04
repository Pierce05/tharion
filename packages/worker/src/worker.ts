import {
  LeaseLostError,
  SqliteStore,
  claimRun,
  findClaimableRuns,
  getRun,
  getWorkflow,
  heartbeatLease,
  heartbeatWorker,
  markWorkerStatus,
  openDb,
  releaseLease,
  setRunStatus,
  upsertWorker,
} from '@tharion/db';
import { HEARTBEAT_MS, LEASE_TTL_MS, SimulatedCrash, errorMessage, executeRun, reduce } from '@tharion/engine';

export interface WorkerOptions {
  workerId: string;
  dbPath?: string;
  pollMs?: number;
  leaseTtlMs?: number;
  heartbeatMs?: number;
  maxConcurrent?: number;
  /** Fault hook: the worker process passes a real SIGKILL-self. In-process default throws SimulatedCrash. */
  crash?: () => never;
  log?: (msg: string) => void;
}

export interface Worker {
  readonly id: string;
  start(): void;
  stop(): Promise<void>;
  activeRuns(): string[];
}

export function createWorker(opts: WorkerOptions): Worker {
  const db = openDb(opts.dbPath);
  const id = opts.workerId;
  const pollMs = opts.pollMs ?? 500;
  const ttl = opts.leaseTtlMs ?? LEASE_TTL_MS;
  const hbMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  const max = opts.maxConcurrent ?? 4;
  const log = opts.log ?? ((): void => undefined);

  const active = new Map<string, Promise<void>>();
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  async function processRun(runId: string): Promise<void> {
    const store = new SqliteStore(db, id);
    let lost = false;
    const hb = setInterval(() => {
      try {
        if (!heartbeatLease(db, runId, id, Date.now(), ttl)) lost = true;
      } catch {
        lost = true;
      }
    }, hbMs);

    try {
      const run = getRun(db, runId);
      if (!run) return;
      const wf = getWorkflow(db, run.workflowId, run.workflowVersion);
      if (!wf) throw new Error(`workflow ${run.workflowId}@${run.workflowVersion} not found`);

      const events = store.events(runId);
      if (events.length === 0) throw new Error('run has no events');
      const before = reduce(wf, events);
      if (before.status === 'completed' || before.status === 'failed' || before.status === 'cancelled') {
        setRunStatus(db, runId, before.status);
        releaseLease(db, runId, id);
        return;
      }

      const progressed = events.some((e) => e.type === 'NODE_STARTED');
      if (progressed) {
        store.append({ runId, nodeId: null, attempt: null, type: 'RUN_RECOVERED', data: { workerId: id } });
        log(`recovered ${runId}`);
      }

      const final = await executeRun({
        store,
        workflow: wf,
        runId,
        dryRun: run.dryRun,
        faults: run.faults,
        crash: opts.crash,
        shouldStop: () => lost || stopped,
      });

      if (final.status === 'completed' || final.status === 'failed' || final.status === 'cancelled') {
        setRunStatus(db, runId, final.status);
        releaseLease(db, runId, id);
        log(`${runId} ${final.status}`);
      }
    } catch (err) {
      if (err instanceof LeaseLostError) {
        log(`lease lost for ${runId}; abandoning`);
        return;
      }
      if (err instanceof SimulatedCrash) {
        log(`simulated crash on ${runId}; abandoning lease`);
        return;
      }
      log(`engine error on ${runId}: ${errorMessage(err)}`);
      try {
        store.append({
          runId,
          nodeId: null,
          attempt: null,
          type: 'RUN_FAILED',
          data: { nodeId: '', error: `engine error: ${errorMessage(err)}` },
        });
        setRunStatus(db, runId, 'failed');
        releaseLease(db, runId, id);
      } catch {
        /* lease already lost: another worker owns the outcome */
      }
    } finally {
      clearInterval(hb);
    }
  }

  function tick(): void {
    if (stopped) return;
    try {
      heartbeatWorker(db, id, Date.now());
      if (active.size >= max) return;
      for (const runId of findClaimableRuns(db, Date.now())) {
        if (active.size >= max) break;
        if (active.has(runId)) continue;
        if (!claimRun(db, runId, id, Date.now(), ttl)) continue;
        log(`claimed ${runId}`);
        const p = processRun(runId)
          .catch((e: unknown) => log(`unexpected: ${errorMessage(e)}`))
          .finally(() => {
            active.delete(runId);
          });
        active.set(runId, p);
      }
    } catch (e) {
      log(`tick error: ${errorMessage(e)}`);
    }
  }

  return {
    id,
    start() {
      upsertWorker(db, id, process.pid, Date.now());
      tick();
      timer = setInterval(tick, pollMs);
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      await Promise.all(active.values());
      markWorkerStatus(db, id, 'stopped');
      db.close();
    },
    activeRuns: () => [...active.keys()],
  };
}