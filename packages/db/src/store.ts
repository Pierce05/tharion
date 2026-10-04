import type { EffectWrite, Json, NewEvent, RunEvent, RunStore } from '@tharion/engine';
import type { Db } from './connection';

export class LeaseLostError extends Error {
  constructor(runId: string, owner: string) {
    super(`lease lost for run ${runId} (worker ${owner})`);
    this.name = 'LeaseLostError';
  }
}

interface EventRow {
  seq: number;
  run_id: string;
  type: string;
  node_id: string | null;
  attempt: number | null;
  data: string;
  ts: number;
}

function toEvent(r: EventRow): RunEvent {
  return {
    seq: r.seq,
    runId: r.run_id,
    ts: r.ts,
    nodeId: r.node_id,
    attempt: r.attempt,
    type: r.type,
    data: JSON.parse(r.data) as unknown,
  } as RunEvent;
}

const INSERT_EVENT = 'INSERT INTO events (run_id, type, node_id, attempt, data, ts) VALUES (?, ?, ?, ?, ?, ?)';
const INSERT_EVENT_FENCED = `INSERT INTO events (run_id, type, node_id, attempt, data, ts)
  SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM runs WHERE id = ? AND lease_owner = ?)`;

/**
 * SQLite-backed RunStore. With `leaseOwner` set, every append is fenced: it only succeeds while
 * that worker still owns the run's lease, otherwise LeaseLostError is thrown.
 */
export class SqliteStore implements RunStore {
  constructor(
    private readonly db: Db,
    private readonly leaseOwner: string | null = null,
    private readonly clock: () => number = Date.now,
  ) {}

  events(runId: string): RunEvent[] {
    return this.eventsAfter(runId, -1);
  }

  /** Events with seq > afterSeq, in order. */
  eventsAfter(runId: string, afterSeq: number): RunEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE run_id = ? AND seq > ? ORDER BY seq')
      .all(runId, afterSeq) as EventRow[];
    return rows.map(toEvent);
  }

  append(ev: NewEvent): RunEvent {
    const ts = this.clock();
    const data = JSON.stringify(ev.data);
    let seq: number;
    if (this.leaseOwner === null) {
      const r = this.db.prepare(INSERT_EVENT).run(ev.runId, ev.type, ev.nodeId, ev.attempt, data, ts);
      seq = Number(r.lastInsertRowid);
    } else {
      const r = this.db
        .prepare(INSERT_EVENT_FENCED)
        .run(ev.runId, ev.type, ev.nodeId, ev.attempt, data, ts, ev.runId, this.leaseOwner);
      if (r.changes === 0) throw new LeaseLostError(ev.runId, this.leaseOwner);
      seq = Number(r.lastInsertRowid);
    }
    return { ...ev, seq, ts } as RunEvent;
  }

  getEffect(runId: string, nodeId: string): Json | undefined {
    const row = this.db.prepare('SELECT result FROM effects WHERE run_id = ? AND node_id = ?').get(runId, nodeId) as
      | { result: string }
      | undefined;
    return row ? (JSON.parse(row.result) as Json) : undefined;
  }

  private writeEffect(runId: string, nodeId: string, result: Json, outbox: EffectWrite): void {
    const t = this.clock();
    this.db
      .prepare('INSERT OR IGNORE INTO effects (run_id, node_id, result, created_at) VALUES (?, ?, ?, ?)')
      .run(runId, nodeId, JSON.stringify(result), t);
    this.db
      .prepare('INSERT OR IGNORE INTO outbox (run_id, node_id, channel, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(runId, nodeId, outbox.channel, JSON.stringify(outbox.payload), t);
  }

  recordEffect(runId: string, nodeId: string, result: Json, outbox: EffectWrite): void {
    this.db.transaction(() => this.writeEffect(runId, nodeId, result, outbox)).immediate();
  }

  /** Effect row + outbox row + NODE_SUCCEEDED in ONE transaction (FR-D5). A lost lease rolls everything back. */
  commitSuccess(ev: NewEvent, effect: EffectWrite & { result: Json }): RunEvent {
    return this.db
      .transaction(() => {
        this.writeEffect(ev.runId, ev.nodeId ?? '', effect.result, effect);
        return this.append(ev);
      })
      .immediate();
  }
}