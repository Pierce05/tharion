import {
  MemoryStore,
  executeRun,
  startRun,
  type Handle,
  type Json,
  type PortType,
  type RetryPolicy,
  type RunEvent,
  type RunFaults,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from '@tharion/engine';

const position = { x: 0, y: 0 };

export const fastRetry = (maxAttempts = 3): RetryPolicy => ({ maxAttempts, backoff: 'fixed', baseMs: 1 });

export const trigger = (id: string, samplePayload: Json = {}): WorkflowNode => ({
  id,
  type: 'trigger',
  label: id,
  position,
  config: { kind: 'manual', samplePayload },
});

export const transform = (id: string, expression: string, outputType?: PortType): WorkflowNode => ({
  id,
  type: 'transform',
  label: id,
  position,
  config: { expression, outputType },
});

export const cond = (id: string, expression: string): WorkflowNode => ({
  id,
  type: 'condition',
  label: id,
  position,
  config: { expression },
});

export const delay = (id: string, ms: number): WorkflowNode => ({ id, type: 'delay', label: id, position, config: { ms } });

export const http = (id: string, url: string, retry?: RetryPolicy): WorkflowNode => ({
  id,
  type: 'http',
  label: id,
  position,
  retry,
  config: { method: 'POST', url, headers: {}, body: '{"ping": true}', timeoutMs: 1000 },
});

export const notify = (id: string, template: string, channel = 'email'): WorkflowNode => ({
  id,
  type: 'notify',
  label: id,
  position,
  config: { channel, template },
});

export const output = (id: string, label: string = id): WorkflowNode => ({
  id,
  type: 'output',
  label: id,
  position,
  config: { label },
});

export const edge = (source: string, target: string, sourceHandle: Handle = 'out', targetHandle: Handle = 'in'): WorkflowEdge => ({
  id: `${source}:${sourceHandle}->${target}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});

export const def = (nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDefinition => ({ nodes, edges });

export interface RunOpts {
  payload?: Json;
  faults?: RunFaults;
  dryRun?: boolean;
  store?: MemoryStore;
}

export async function runWorkflow(workflow: WorkflowDefinition, opts: RunOpts = {}) {
  const store = opts.store ?? new MemoryStore();
  const runId = 'run1';
  startRun(store, { runId, workflowVersion: 1, triggerPayload: opts.payload ?? {} });
  const state = await executeRun({ store, workflow, runId, faults: opts.faults, dryRun: opts.dryRun });
  return { store, runId, state, events: store.events(runId) };
}

export const typesFor = (events: RunEvent[], nodeId: string): string[] =>
  events.filter((e) => e.nodeId === nodeId).map((e) => e.type);

export function resultOf(events: RunEvent[]): Json | undefined {
  const last = events[events.length - 1];
  return last?.type === 'RUN_COMPLETED' ? last.data.result : undefined;
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}