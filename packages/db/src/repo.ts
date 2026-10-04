import { randomBytes } from 'node:crypto';
import type {
  Json,
  Lineage,
  LineageNode,
  NewEvent,
  OutboxRow,
  RunFaults,
  RunRecord,
  RunStatus,
  Workflow,
  WorkflowDefinition,
} from '@tharion/engine';
import type { Db } from './connection';
import { SqliteStore } from './store';

export const isTerminal = (s: RunStatus): boolean => s === 'completed' || s === 'failed' || s === 'cancelled';

// ---------- workflows ----------
interface WorkflowRow {
  id: string;
  version: number;
  name: string;
  definition: string;
  created_at: number;
}

function toWorkflow(r: WorkflowRow): Workflow {
  const def = JSON.parse(r.definition) as WorkflowDefinition;
  return { id: r.id, version: r.version, name: r.name, createdAt: r.created_at, nodes: def.nodes, edges: def.edges };
}

export function saveWorkflow(db: Db, a: { id: string; name: string; definition: WorkflowDefinition }): Workflow {
  return db
    .transaction((): Workflow => {
      const max = db.prepare('SELECT MAX(version) FROM workflows WHERE id = ?').pluck().get(a.id) as number | null;
      const version = (max ?? 0) + 1;
      const createdAt = Date.now();
      const body: WorkflowDefinition = { nodes: a.definition.nodes, edges: a.definition.edges };
      db.prepare('INSERT INTO workflows (id, version, name, definition, created_at) VALUES (?, ?, ?, ?, ?)').run(
        a.id,
        version,
        a.name,
        JSON.stringify(body),
        createdAt,
      );
      return { id: a.id, name: a.name, version, createdAt, ...body };
    })
    .immediate();
}

export function getWorkflow(db: Db, id: string, version?: number): Workflow | null {
  const row =
    version === undefined
      ? db.prepare('SELECT * FROM workflows WHERE id = ? ORDER BY version DESC LIMIT 1').get(id)
      : db.prepare('SELECT * FROM workflows WHERE id = ? AND version = ?').get(id, version);
  return row ? toWorkflow(row as WorkflowRow) : null;
}

export function listWorkflows(db: Db): { id: string; name: string; version: number; createdAt: number }[] {
  const rows = db
    .prepare(
      `SELECT w.id, w.name, w.version, w.created_at FROM workflows w
       JOIN (SELECT id, MAX(version) AS v FROM workflows GROUP BY id) m ON m.id = w.id AND m.v = w.version
       ORDER BY w.created_at DESC`,
    )
    .all() as { id: string; name: string; version: number; created_at: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, version: r.version, createdAt: r.created_at }));
}

// ---------- runs ----------
interface RunRow {
  id: string;
  workflow_id: string;
  workflow_version: number;
  status: RunStatus;
  trigger_payload: string;
  parent_run_id: string | null;
  forked_at_node_id: string | null;
  dry_run: number;
  faults: string | null;
  lease_owner: string | null;
  lease_expires_at: number | null;
  created_at: number;
  updated_at: number;
}

function toRun(r: RunRow): RunRecord {
  return {
    id: r.id,
    workflowId: r.workflow_id,
    workflowVersion: r.workflow_version,
    status: r.status,
    triggerPayload: JSON.parse(r.trigger_payload) as Json,
    parentRunId: r.parent_run_id,
    forkedAtNodeId: r.forked_at_node_id,
    dryRun: r.dry_run === 1,
    faults: r.faults ? (JSON.parse(r.faults) as RunFaults) : null,
    leaseOwner: r.lease_owner,
    leaseExpiresAt: r.lease_expires_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getRun(db: Db, id: string): RunRecord | null {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
  return row ? toRun(row) : null;
}

export function listRuns(db: Db, opts: { workflowId?: string; limit?: number } = {}): RunRecord[] {
  const limit = opts.limit ?? 50;
  const rows = (
    opts.workflowId
      ? db.prepare('SELECT * FROM runs WHERE workflow_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(opts.workflowId, limit)
      : db.prepare('SELECT * FROM runs ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit)
  ) as RunRow[];
  return rows.map(toRun);
}

export interface CreateRunArgs {
  workflowId: string;
  workflowVersion: number;
  triggerPayload: Json;
  dryRun: boolean;
  faults: RunFaults | null;
  parentRunId?: string;
  forkedAtNodeId?: string;
  inputOverride?: Json;
  /** Events appended right after RUN_STARTED, inside the same transaction (fork replay). */
  replay?: (runId: string) => NewEvent[];
  idempotency?: { token: string; key: string };
}

/** Inserts the run row + RUN_STARTED (+ replay events, + webhook delivery) atomically. Dedupes on (token, key). */
export function createRun(db: Db, a: CreateRunArgs): { run: RunRecord; deduped: boolean } {
  const { runId, deduped } = db
    .transaction((): { runId: string; deduped: boolean } => {
      if (a.idempotency) {
        const ex = db
          .prepare('SELECT run_id FROM webhook_deliveries WHERE token = ? AND idempotency_key = ?')
          .get(a.idempotency.token, a.idempotency.key) as { run_id: string } | undefined;
        if (ex) return { runId: ex.run_id, deduped: true };
      }
      const id = `run_${randomBytes(6).toString('hex')}`;
      const t = Date.now();
      db.prepare(
        `INSERT INTO runs (id, workflow_id, workflow_version, status, trigger_payload, parent_run_id, forked_at_node_id,
                           dry_run, faults, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        a.workflowId,
        a.workflowVersion,
        JSON.stringify(a.triggerPayload),
        a.parentRunId ?? null,
        a.forkedAtNodeId ?? null,
        a.dryRun ? 1 : 0,
        a.faults ? JSON.stringify(a.faults) : null,
        t,
        t,
      );
      if (a.idempotency) {
        db.prepare('INSERT INTO webhook_deliveries (token, idempotency_key, run_id, created_at) VALUES (?, ?, ?, ?)').run(
          a.idempotency.token,
          a.idempotency.key,
          id,
          t,
        );
      }
      const store = new SqliteStore(db);
      store.append({
        runId: id,
        nodeId: null,
        attempt: null,
        type: 'RUN_STARTED',
        data: {
          workflowVersion: a.workflowVersion,
          triggerPayload: a.triggerPayload,
          ...(a.parentRunId ? { parentRunId: a.parentRunId } : {}),
          ...(a.forkedAtNodeId ? { forkedAtNodeId: a.forkedAtNodeId } : {}),
          ...(a.inputOverride !== undefined ? { inputOverride: a.inputOverride } : {}),
        },
      });
      for (const ev of a.replay?.(id) ?? []) store.append(ev);
      return { runId: id, deduped: false };
    })
    .immediate();
  return { run: getRun(db, runId) as RunRecord, deduped };
}

export function setRunStatus(db: Db, id: string, status: RunStatus): void {
  db.prepare('UPDATE runs SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
}

// ---------- leases (FR-D1..D3) ----------
export function findClaimableRuns(db: Db, now: number, limit = 20): string[] {
  return db
    .prepare(
      `SELECT id FROM runs WHERE status IN ('queued', 'running') AND (lease_owner IS NULL OR lease_expires_at < ?)
       ORDER BY created_at LIMIT ?`,
    )
    .pluck()
    .all(now, limit) as string[];
}

export function claimRun(db: Db, runId: string, workerId: string, now: number, ttlMs: number): boolean {
  const r = db
    .prepare(
      `UPDATE runs SET lease_owner = ?, lease_expires_at = ?, updated_at = ?,
         status = CASE WHEN status = 'queued' THEN 'running' ELSE status END
       WHERE id = ? AND status IN ('queued', 'running') AND (lease_owner IS NULL OR lease_expires_at < ?)`,
    )
    .run(workerId, now + ttlMs, now, runId, now);
  return r.changes === 1;
}

export function heartbeatLease(db: Db, runId: string, workerId: string, now: number, ttlMs: number): boolean {
  const r = db
    .prepare('UPDATE runs SET lease_expires_at = ? WHERE id = ? AND lease_owner = ?')
    .run(now + ttlMs, runId, workerId);
  return r.changes === 1;
}

export function releaseLease(db: Db, runId: string, workerId: string): void {
  db.prepare('UPDATE runs SET lease_owner = NULL, lease_expires_at = NULL WHERE id = ? AND lease_owner = ?').run(
    runId,
    workerId,
  );
}

// ---------- workers ----------
export interface WorkerRecord {
  id: string;
  pid: number;
  lastHeartbeat: number;
  status: string;
}

export function upsertWorker(db: Db, id: string, pid: number, now: number): void {
  db.prepare(
    `INSERT INTO workers (id, pid, last_heartbeat, status) VALUES (?, ?, ?, 'alive')
     ON CONFLICT(id) DO UPDATE SET pid = excluded.pid, last_heartbeat = excluded.last_heartbeat, status = 'alive'`,
  ).run(id, pid, now);
}

export function heartbeatWorker(db: Db, id: string, now: number): void {
  db.prepare("UPDATE workers SET last_heartbeat = ? WHERE id = ? AND status = 'alive'").run(now, id);
}

export function markWorkerStatus(db: Db, id: string, status: 'alive' | 'dead' | 'stopped'): void {
  db.prepare('UPDATE workers SET status = ? WHERE id = ?').run(status, id);
}

export function markAllWorkersDead(db: Db): void {
  db.prepare("UPDATE workers SET status = 'dead' WHERE status = 'alive'").run();
}

export function listWorkers(db: Db, limit = 5): WorkerRecord[] {
  const rows = db.prepare('SELECT * FROM workers ORDER BY last_heartbeat DESC LIMIT ?').all(limit) as {
    id: string;
    pid: number;
    last_heartbeat: number;
    status: string;
  }[];
  return rows.map((r) => ({ id: r.id, pid: r.pid, lastHeartbeat: r.last_heartbeat, status: r.status }));
}

// ---------- outbox & hooks ----------
export function listOutbox(db: Db, limit = 200): OutboxRow[] {
  const rows = db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT ?').all(limit) as {
    id: number;
    run_id: string;
    node_id: string;
    channel: string;
    payload: string;
    created_at: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    nodeId: r.node_id,
    channel: r.channel,
    payload: JSON.parse(r.payload) as Json,
    createdAt: r.created_at,
  }));
}

export function countOutbox(db: Db): number {
  return db.prepare('SELECT COUNT(*) FROM outbox').pluck().get() as number;
}

export function getOrCreateHook(db: Db, workflowId: string): string {
  return db
    .transaction((): string => {
      const ex = db.prepare('SELECT token FROM hooks WHERE workflow_id = ? LIMIT 1').pluck().get(workflowId) as
        | string
        | undefined;
      if (ex) return ex;
      const token = `wh_${randomBytes(9).toString('hex')}`;
      db.prepare('INSERT INTO hooks (token, workflow_id, created_at) VALUES (?, ?, ?)').run(token, workflowId, Date.now());
      return token;
    })
    .immediate();
}

export function getHook(db: Db, token: string): { workflowId: string } | null {
  const row = db.prepare('SELECT workflow_id FROM hooks WHERE token = ?').get(token) as
    | { workflow_id: string }
    | undefined;
  return row ? { workflowId: row.workflow_id } : null;
}

// ---------- lineage (FR-T5) ----------
export function getLineage(db: Db, runId: string): Lineage | null {
  let cur = getRun(db, runId);
  if (!cur) return null;
  const climbed = new Set<string>([cur.id]);
  while (cur.parentRunId && !climbed.has(cur.parentRunId)) {
    const parent = getRun(db, cur.parentRunId);
    if (!parent) break;
    climbed.add(parent.id);
    cur = parent;
  }
  const rootId = cur.id;
  const nodes: LineageNode[] = [];
  const queue = [rootId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (visited.has(id)) continue;
    visited.add(id);
    const r = getRun(db, id);
    if (!r) continue;
    nodes.push({ id: r.id, parentRunId: r.parentRunId, forkedAtNodeId: r.forkedAtNodeId, status: r.status, createdAt: r.createdAt });
    const kids = db.prepare('SELECT id FROM runs WHERE parent_run_id = ? ORDER BY created_at, rowid').pluck().all(id) as string[];
    queue.push(...kids);
  }
  return { rootId, nodes };
}