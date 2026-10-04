import { indexGraph, type GraphIndex } from './graph';
import type {
  EdgeState,
  Handle,
  Json,
  NodeState,
  RunEvent,
  RunState,
  WorkflowDefinition,
} from './types';

export function emptyState(def: WorkflowDefinition): RunState {
  const nodes: Record<string, NodeState> = {};
  const edges: Record<string, EdgeState> = {};
  for (const n of def.nodes) nodes[n.id] = { status: 'pending', attempt: 0 };
  for (const e of def.edges) edges[e.id] = { resolved: false, taken: false };
  return { status: 'queued', nodes, edges, cursor: 0 };
}

function resolveEdges(idx: GraphIndex, state: RunState, nodeId: string, takenHandle: Handle | null, payload?: Json): void {
  for (const e of idx.outbound.get(nodeId) ?? []) {
    const taken = takenHandle !== null && e.sourceHandle === takenHandle;
    state.edges[e.id] = taken ? { resolved: true, taken: true, payload } : { resolved: true, taken: false };
  }
}

function applyEvent(idx: GraphIndex, state: RunState, ev: RunEvent): void {
  switch (ev.type) {
    case 'RUN_STARTED':
      state.status = 'running';
      return;
    case 'RUN_RECOVERED':
    case 'NODE_SCHEDULED':
      return;
    case 'RUN_COMPLETED':
      state.status = 'completed';
      return;
    case 'RUN_FAILED':
      state.status = 'failed';
      return;
    case 'RUN_CANCELLED':
      state.status = 'cancelled';
      return;
    default:
      break;
  }

  const nodeId = ev.nodeId;
  if (nodeId === null) return;
  const node = state.nodes[nodeId];
  if (!node) return;

  switch (ev.type) {
    case 'NODE_STARTED':
      node.status = 'running';
      node.attempt = ev.attempt ?? node.attempt + 1;
      node.input = ev.data.input;
      node.startedAt = ev.ts;
      delete node.error;
      delete node.retryAt;
      delete node.endedAt;
      return;
    case 'NODE_SUCCEEDED':
      node.status = 'succeeded';
      node.output = ev.data.output;
      node.durationMs = ev.data.durationMs;
      node.handle = ev.data.handle ?? 'out';
      node.endedAt = ev.ts;
      if (ev.attempt !== null) node.attempt = ev.attempt;
      delete node.error;
      delete node.retryAt;
      resolveEdges(idx, state, nodeId, node.handle, ev.data.output);
      return;
    case 'NODE_FAILED_ATTEMPT':
      node.status = 'retrying';
      node.error = ev.data.error;
      return;
    case 'RETRY_SCHEDULED':
      node.status = 'retrying';
      node.retryAt = ev.data.at;
      return;
    case 'NODE_FAILED':
      node.status = 'failed';
      node.error = ev.data.error;
      node.endedAt = ev.ts;
      delete node.retryAt;
      return;
    case 'NODE_SKIPPED':
      node.status = 'skipped';
      node.endedAt = ev.ts;
      resolveEdges(idx, state, nodeId, null);
      return;
    case 'NODE_REPLAYED':
      node.status = 'succeeded';
      node.replayed = true;
      node.input = ev.data.input;
      node.output = ev.data.output;
      node.handle = ev.data.handle ?? 'out';
      node.endedAt = ev.ts;
      resolveEdges(idx, state, nodeId, node.handle, ev.data.output);
      return;
    default:
      return;
  }
}

/**
 * Pure: same (def, events, upTo) always yields the same state. Never mutates its inputs.
 * `upTo` = number of events applied (cursor); defaults to all of them.
 */
export function reduce(def: WorkflowDefinition, events: readonly RunEvent[], upTo: number = events.length): RunState {
  const idx = indexGraph(def);
  const state = emptyState(def);
  const end = Math.max(0, Math.min(upTo, events.length));
  for (let i = 0; i < end; i++) applyEvent(idx, state, events[i] as RunEvent);
  state.cursor = end;
  return state;
}