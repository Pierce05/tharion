import type {
  Json,
  JsonObject,
  OutboxRow,
  RunEvent,
  RunFaults,
  RunRecord,
  RunState,
  ValidationIssue,
  Workflow,
  WorkflowDefinition,
} from '@tharion/engine';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function req<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the API server. Is `pnpm dev` running?');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const obj = typeof data === 'object' && data !== null ? (data as { error?: unknown; details?: unknown }) : {};
    throw new ApiError(res.status, typeof obj.error === 'string' ? obj.error : `HTTP ${res.status}`, obj.details);
  }
  return data as T;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  version: number;
  createdAt: number;
}

export interface RunDetail {
  run: RunRecord;
  workflow: Workflow | null;
  state: RunState | null;
  eventCount: number;
}

export interface SystemInfo {
  now: number;
  supervisor: { workerId: string | null; pid: number | null; alive: boolean; autoRestart: boolean; startedAt: number | null } | null;
  workers: { id: string; pid: number; lastHeartbeat: number; status: string; alive: boolean }[];
  leases: { runId: string; owner: string; expiresAt: number; remainingMs: number }[];
  counts: { runsByStatus: Record<string, number>; outbox: number; events: number };
}

export const api = {
  listWorkflows: () => req<{ workflows: WorkflowSummary[] }>('GET', '/api/workflows'),
  getWorkflow: (id: string, version?: number) =>
    req<Workflow>('GET', `/api/workflows/${encodeURIComponent(id)}${version ? `?version=${version}` : ''}`),
  createWorkflow: (name: string, definition: WorkflowDefinition) => req<Workflow>('POST', '/api/workflows', { name, definition }),
  saveWorkflow: (id: string, name: string, definition: WorkflowDefinition) =>
    req<Workflow>('PUT', `/api/workflows/${encodeURIComponent(id)}`, { name, definition }),
  validate: (id: string, definition: WorkflowDefinition) =>
    req<{ issues: ValidationIssue[]; valid: boolean }>('POST', `/api/workflows/${encodeURIComponent(id)}/validate`, { definition }),
  startRun: (id: string, body: { payload: JsonObject; dryRun?: boolean; faults?: RunFaults; version?: number }) =>
    req<{ run: RunRecord }>('POST', `/api/workflows/${encodeURIComponent(id)}/runs`, body),
  listRuns: (limit = 50, workflowId?: string) =>
    req<{ runs: RunRecord[] }>('GET', `/api/runs?limit=${limit}${workflowId ? `&workflowId=${encodeURIComponent(workflowId)}` : ''}`),
  getRun: (id: string) => req<RunDetail>('GET', `/api/runs/${encodeURIComponent(id)}`),
  runEvents: (id: string, from = 0) => req<{ events: RunEvent[] }>('GET', `/api/runs/${encodeURIComponent(id)}/events?from=${from}`),
  outbox: () => req<{ rows: OutboxRow[]; count: number }>('GET', '/api/outbox'),
  system: () => req<SystemInfo>('GET', '/api/system'),

  killWorker: () => req<{ killed: { id: string; pid: number } }>('POST', '/api/chaos/kill-worker'),
  startWorker: () => req<{ started: { id: string; pid: number } }>('POST', '/api/chaos/start-worker'),
  setAutoRestart: (enabled: boolean) => req<{ autoRestart: boolean }>('POST', '/api/chaos/auto-restart', { enabled }),
  hookToken: (workflowId: string) => req<{ token: string }>('POST', `/api/workflows/${encodeURIComponent(workflowId)}/hook`),
  fireHook: (token: string, payload: JsonObject, idempotencyKey: string) =>
    req<{ runId: string; deduped: boolean }>('POST', `/api/hooks/${encodeURIComponent(token)}`, payload, {
      'Idempotency-Key': idempotencyKey,
    }),
};

export type { Json };