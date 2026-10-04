import { DEFAULT_RETRY } from './constants';
import { findReady, indexGraph, nodeInput, type GraphIndex } from './graph';
import { executeNode, type NodeOutcome } from './nodes';
import { reduce } from './reducer';
import type { RunStore } from './store';
import type {
  Json,
  NewEvent,
  RetryPolicy,
  RunEvent,
  RunFaults,
  RunState,
  WorkflowDefinition,
  WorkflowNode,
} from './types';
import { SimulatedCrash, errorMessage } from './util';

export interface ExecutorDeps {
  store: RunStore;
  workflow: WorkflowDefinition;
  runId: string;
  dryRun?: boolean;
  faults?: RunFaults | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Called at the crashAfterEffect fault point. The worker passes a real SIGKILL; default throws SimulatedCrash. */
  crash?: () => never;
  /** Polled between scheduling rounds (e.g. lease lost). When true, stop scheduling and return without a terminal event. */
  shouldStop?: () => boolean;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const defaultCrash = (): never => {
  throw new SimulatedCrash();
};

export function backoffMs(policy: RetryPolicy, attempt: number): number {
  return policy.backoff === 'exponential' ? policy.baseMs * 2 ** (attempt - 1) : policy.baseMs;
}

export function startRun(
  store: RunStore,
    args: { runId: string; workflowVersion: number; triggerPayload: Json; parentRunId?: string; forkedAtNodeId?: string; inputOverride?: Json },
): RunEvent {
  const { runId, ...data } = args;
  return store.append({ runId, nodeId: null, attempt: null, type: 'RUN_STARTED', data });
}

function buildResult(def: WorkflowDefinition, state: RunState): Json {
  const result: { [k: string]: Json } = {};
  for (const node of def.nodes) {
    if (node.type !== 'output') continue;
    const ns = state.nodes[node.id];
    if (ns && ns.status === 'succeeded' && ns.output !== undefined) result[node.config.label] = ns.output;
  }
  return result;
}

async function attemptNode(
  deps: ExecutorDeps,
  node: WorkflowNode,
  input: Json,
  attempt: number,
  sleep: (ms: number) => Promise<void>,
): Promise<NodeOutcome> {
  // FR-D5: an effect already recorded for (runId, nodeId) is returned without re-executing.
  const recorded = deps.store.getEffect(deps.runId, node.id);
  if (recorded !== undefined) return { output: recorded };

  const slow = deps.faults?.slowNodes?.find((f) => f.nodeId === node.id);
  if (slow) await sleep(slow.ms);
  const fail = deps.faults?.failNodes?.find((f) => f.nodeId === node.id);
  if (fail && attempt <= fail.times) throw new Error(`injected failure (attempt ${attempt} of ${fail.times})`);

  return executeNode(node, input, {
    runId: deps.runId,
    nodeId: node.id,
    attempt,
    dryRun: deps.dryRun === true,
    sleep,
  });
}

function commitSuccess(deps: ExecutorDeps, node: WorkflowNode, attempt: number, outcome: NodeOutcome, durationMs: number): void {
  const ev: NewEvent = {
    runId: deps.runId,
    nodeId: node.id,
    attempt,
    type: 'NODE_SUCCEEDED',
    data: { output: outcome.output, durationMs, ...(outcome.handle ? { handle: outcome.handle } : {}) },
  };
  if (!outcome.effect) {
    deps.store.append(ev);
    return;
  }
    if (deps.faults?.crashAfterEffect === node.id && attempt === 1) {
    // Simulate dying in the window between the external effect and the event commit.
    deps.store.recordEffect(deps.runId, node.id, outcome.output, outcome.effect);
    (deps.crash ?? defaultCrash)();
  }
  deps.store.commitSuccess(ev, { result: outcome.output, ...outcome.effect });
}

async function runNode(deps: ExecutorDeps, idx: GraphIndex, node: WorkflowNode, triggerPayload: Json, override: Json | undefined,): Promise<void> {
  const { store, runId, workflow } = deps;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const policy = node.retry ?? DEFAULT_RETRY;

  const state = reduce(workflow, store.events(runId));
  const ns = state.nodes[node.id];
  if (!ns) return;
  const input = override !== undefined ? override : node.type === 'trigger' ? triggerPayload : nodeInput(idx, state, node);

  // Resume: crashed or retrying with no attempts left (FR-D4: the counter never resets).
  if ((ns.status === 'retrying' || ns.status === 'running') && ns.attempt >= policy.maxAttempts) {
    store.append({
      runId,
      nodeId: node.id,
      attempt: ns.attempt,
      type: 'NODE_FAILED',
      data: { error: ns.error ?? 'worker lost during the final attempt' },
    });
    return;
  }
  // FR-E7: honor the persisted retry delay after recovery.
  if (ns.status === 'retrying' && ns.retryAt !== undefined) {
    const wait = ns.retryAt - now();
    if (wait > 0) await sleep(wait);
  }

  let attempt = ns.attempt + 1;
  for (;;) {
    store.append({ runId, nodeId: node.id, attempt, type: 'NODE_STARTED', data: { input } });
    const startedAt = now();
    let outcome: NodeOutcome;
    try {
      outcome = await attemptNode(deps, node, input, attempt, sleep);
    } catch (err) {
      if (err instanceof SimulatedCrash) throw err;
      const error = errorMessage(err);
      store.append({
        runId,
        nodeId: node.id,
        attempt,
        type: 'NODE_FAILED_ATTEMPT',
        data: { error, durationMs: now() - startedAt },
      });
      if (attempt >= policy.maxAttempts) {
        store.append({ runId, nodeId: node.id, attempt, type: 'NODE_FAILED', data: { error } });
        return;
      }
      const delay = backoffMs(policy, attempt);
      store.append({ runId, nodeId: node.id, attempt, type: 'RETRY_SCHEDULED', data: { at: now() + delay } });
      await sleep(delay);
      attempt += 1;
      continue;
    }
    commitSuccess(deps, node, attempt, outcome, now() - startedAt);
    return;
  }
}

/**
 * FR-E2. Replays events, finds ready nodes, runs them concurrently, appends events, repeats.
 * Safe to call again on a partially executed run (resume): all progress is derived from events.
 */
export async function executeRun(deps: ExecutorDeps): Promise<RunState> {
  const { store, workflow, runId } = deps;
  const idx = indexGraph(workflow);
  const first = store.events(runId)[0];
  if (!first || first.type !== 'RUN_STARTED') throw new Error(`run ${runId} has no RUN_STARTED event`);
  const triggerPayload = first.data.triggerPayload;
  const forkedAt = first.data.forkedAtNodeId;
  const override = first.data.inputOverride;
  const running = new Map<string, Promise<void>>();
  const box: { hasFatal: boolean; error: unknown } = { hasFatal: false, error: null };

  for (;;) {
    if (box.hasFatal) throw box.error;

    const state = reduce(workflow, store.events(runId));
    if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
      await Promise.all(running.values());
      return state;
    }

    const stopped = deps.shouldStop?.() === true;
    const failedEntry = Object.entries(state.nodes).find(([, n]) => n.status === 'failed');

    if (!failedEntry && !stopped) {
      const { ready, toSkip } = findReady(idx, state);
      if (toSkip.length > 0) {
        // FR-E4: propagate skips, then re-evaluate readiness.
        for (const n of toSkip) {
          store.append({ runId, nodeId: n.id, attempt: null, type: 'NODE_SKIPPED', data: { reason: 'no inbound edge was taken' } });
        }
        continue;
      }
      for (const node of ready) {
        if (running.has(node.id)) continue;
                const task = runNode(deps, idx, node, triggerPayload, node.id === forkedAt ? override : undefined).then(
          () => undefined,
          (error: unknown) => {
            box.hasFatal = true;
            box.error = error;
          },
        );
        running.set(
          node.id,
          task.finally(() => running.delete(node.id)),
        );
      }
    }

    if (running.size === 0) {
      if (stopped) return state;
      if (failedEntry) {
        const [nodeId, n] = failedEntry;
        store.append({ runId, nodeId: null, attempt: null, type: 'RUN_FAILED', data: { nodeId, error: n.error ?? 'node failed' } });
      } else {
        store.append({ runId, nodeId: null, attempt: null, type: 'RUN_COMPLETED', data: { result: buildResult(workflow, state) } });
      }
      return reduce(workflow, store.events(runId));
    }

    await Promise.race(running.values());
  }
}