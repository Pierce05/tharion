import type { RunEvent } from './types';

export type LogLevel = 'info' | 'warn' | 'error';
const RANK: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };

export function eventLevel(ev: RunEvent): LogLevel {
  switch (ev.type) {
    case 'NODE_FAILED_ATTEMPT':
    case 'NODE_FAILED':
    case 'RUN_FAILED':
      return 'error';
    case 'RETRY_SCHEDULED':
    case 'RUN_RECOVERED':
    case 'RUN_CANCELLED':
      return 'warn';
    default:
      return 'info';
  }
}

export function eventDetail(ev: RunEvent): string {
  switch (ev.type) {
    case 'NODE_FAILED_ATTEMPT':
    case 'NODE_FAILED':
    case 'RUN_FAILED':
      return ev.data.error;
    case 'RETRY_SCHEDULED':
      return `retry in ${Math.max(0, ev.data.at - ev.ts)}ms`;
    case 'NODE_SKIPPED':
      return ev.data.reason;
    case 'NODE_SUCCEEDED':
      return `${ev.data.durationMs}ms${ev.data.handle && ev.data.handle !== 'out' ? ` · ${ev.data.handle}` : ''}`;
    case 'RUN_RECOVERED':
      return `worker ${ev.data.workerId}`;
    case 'NODE_REPLAYED':
      return `from ${ev.data.fromRunId}`;
    default:
      return '';
  }
}

export interface LogFilter {
  nodeId?: string | null;
  /** Minimum severity to show. */
  level?: LogLevel | 'all';
  query?: string;
}

export function filterEvents(events: readonly RunEvent[], f: LogFilter): RunEvent[] {
  const q = f.query?.trim().toLowerCase();
  const min = f.level && f.level !== 'all' ? RANK[f.level] : 0;
  return events.filter((ev) => {
    if (f.nodeId && ev.nodeId !== f.nodeId) return false;
    if (RANK[eventLevel(ev)] < min) return false;
    if (q) {
      const hay = `${ev.type} ${ev.nodeId ?? ''} ${eventDetail(ev)} ${JSON.stringify(ev.data)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export interface DeliveryProof {
  nodeId: string;
  key: string; // idempotency key: runId:nodeId, stable across attempts
  attempts: number; // NODE_STARTED events for the node
  rows: number; // outbox rows for (run, node): must be 1
}

export function deliveryProof(
  events: readonly RunEvent[],
  outbox: readonly { runId: string; nodeId: string }[],
  runId: string,
): DeliveryProof[] {
  const rows = new Map<string, number>();
  for (const r of outbox) if (r.runId === runId) rows.set(r.nodeId, (rows.get(r.nodeId) ?? 0) + 1);
  const out: DeliveryProof[] = [];
  for (const [nodeId, n] of rows) {
    out.push({
      nodeId,
      key: `${runId}:${nodeId}`,
      rows: n,
      attempts: events.filter((e) => e.type === 'NODE_STARTED' && e.nodeId === nodeId).length,
    });
  }
  return out;
}

export function lastRecovery(events: readonly RunEvent[]): { seq: number; ts: number; workerId: string } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e && e.type === 'RUN_RECOVERED') return { seq: e.seq, ts: e.ts, workerId: e.data.workerId };
  }
  return null;
}