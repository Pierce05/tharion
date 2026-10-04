import type { Json, RunEvent } from '@tharion/engine';

/** Gap-weighted x positions (0..100): instant events stay distinct, long gaps (e.g. a dead worker) show as a hole. */
export function eventPositions(events: readonly RunEvent[]): number[] {
  if (events.length === 0) return [];
  const raw: number[] = [];
  let acc = 0;
  events.forEach((e, i) => {
    if (i > 0) {
      const prev = events[i - 1] as RunEvent;
      acc += 1 + Math.min(2500, Math.max(0, e.ts - prev.ts)) / 100;
    }
    raw.push(acc);
  });
  const total = acc || 1;
  return raw.map((v) => (v / total) * 100);
}

/** `cursor` = number of events applied (0..n). */
export function cursorToPct(positions: readonly number[], cursor: number): number {
  if (cursor <= 0 || positions.length === 0) return 0;
  return positions[Math.min(cursor, positions.length) - 1] ?? 0;
}

export function pctToCursor(positions: readonly number[], pct: number): number {
  if (positions.length === 0 || pct < 0.4) return 0;
  let best = 0;
  for (let i = 1; i < positions.length; i++) {
    if (Math.abs((positions[i] ?? 0) - pct) < Math.abs((positions[best] ?? 0) - pct)) best = i;
  }
  return best + 1;
}

export interface AttemptRecord {
  attempt: number;
  input?: Json;
  output?: Json;
  error?: string;
  outcome: 'running' | 'succeeded' | 'failed' | 'replayed';
}

export function attemptRecords(events: readonly RunEvent[], nodeId: string, upTo: number): AttemptRecord[] {
  const out: AttemptRecord[] = [];
  for (let i = 0; i < upTo && i < events.length; i++) {
    const e = events[i] as RunEvent;
    if (e.nodeId !== nodeId) continue;
    const cur = out[out.length - 1];
    switch (e.type) {
      case 'NODE_STARTED':
        out.push({ attempt: e.attempt ?? out.length + 1, input: e.data.input, outcome: 'running' });
        break;
      case 'NODE_FAILED_ATTEMPT':
        if (cur) {
          cur.error = e.data.error;
          cur.outcome = 'failed';
        }
        break;
      case 'NODE_SUCCEEDED':
        if (cur) {
          cur.output = e.data.output;
          cur.outcome = 'succeeded';
        }
        break;
      case 'NODE_REPLAYED':
        out.push({ attempt: 1, input: e.data.input, output: e.data.output, outcome: 'replayed' });
        break;
      default:
        break;
    }
  }
  return out;
}