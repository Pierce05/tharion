import type { Json, NewEvent, OutboxRow, RunEvent } from './types';

export interface EffectWrite {
  channel: string;
  payload: Json;
}

/** Persistence port. The SQLite implementation (Phase 2) and MemoryStore both satisfy it. */
export interface RunStore {
  events(runId: string): RunEvent[];
  append(ev: NewEvent): RunEvent;
  getEffect(runId: string, nodeId: string): Json | undefined;
  /** Idempotent: a no-op when an effect for (runId, nodeId) already exists. */
  recordEffect(runId: string, nodeId: string, result: Json, outbox: EffectWrite): void;
  /** Effect + outbox + event in ONE transaction. */
  commitSuccess(ev: NewEvent, effect: EffectWrite & { result: Json }): RunEvent;
}

export class MemoryStore implements RunStore {
  private log = new Map<string, RunEvent[]>();
  private effects = new Map<string, Json>();
  private seq = 0;
  readonly outbox: OutboxRow[] = [];
  onAppend?: (ev: RunEvent) => void;

  constructor(private clock: () => number = Date.now) {}

  events(runId: string): RunEvent[] {
    return [...(this.log.get(runId) ?? [])];
  }

  append(ev: NewEvent): RunEvent {
    const full = { ...ev, seq: ++this.seq, ts: this.clock() } as RunEvent;
    const list = this.log.get(ev.runId);
    if (list) list.push(full);
    else this.log.set(ev.runId, [full]);
    this.onAppend?.(full);
    return full;
  }

  getEffect(runId: string, nodeId: string): Json | undefined {
    return this.effects.get(`${runId}:${nodeId}`);
  }

  recordEffect(runId: string, nodeId: string, result: Json, outbox: EffectWrite): void {
    const key = `${runId}:${nodeId}`;
    if (this.effects.has(key)) return;
    this.effects.set(key, result);
    this.outbox.push({
      id: this.outbox.length + 1,
      runId,
      nodeId,
      channel: outbox.channel,
      payload: outbox.payload,
      createdAt: this.clock(),
    });
  }

  commitSuccess(ev: NewEvent, effect: EffectWrite & { result: Json }): RunEvent {
    this.recordEffect(ev.runId, ev.nodeId ?? '', effect.result, effect);
    return this.append(ev);
  }
}