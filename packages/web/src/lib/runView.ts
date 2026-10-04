import { DEFAULT_RETRY, type Json, type RunState, type WorkflowDefinition } from '@tharion/engine';
import type { NodeView } from '../components/NodeCard';
import type { EdgeView } from '../components/PacketEdge';

export function nodeViewsFrom(
  def: WorkflowDefinition,
  state: RunState,
  opts: { stalled?: boolean; playheadNodeId?: string | null; divergedNodeId?: string | null } = {},
): Record<string, NodeView> {
  const out: Record<string, NodeView> = {};
  for (const node of def.nodes) {
    const ns = state.nodes[node.id];
    if (!ns) continue;
    out[node.id] = {
      status: ns.status,
      attempt: ns.attempt,
      durationMs: ns.durationMs,
      replayed: ns.replayed === true,
      maxAttempts: node.retry?.maxAttempts ?? DEFAULT_RETRY.maxAttempts,
      stalled: opts.stalled === true && ns.status === 'running',
      playhead: opts.playheadNodeId === node.id,
      diverged: opts.divergedNodeId === node.id,
    };
  }
  return out;
}

export function edgePayloadsFrom(state: RunState): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [id, e] of Object.entries(state.edges)) if (e.taken && e.payload !== undefined) out[id] = e.payload;
  return out;
}

export function edgeViewsFrom(def: WorkflowDefinition, state: RunState, alive = true): Record<string, EdgeView> {
  const out: Record<string, EdgeView> = {};
  for (const e of def.edges) {
    const es = state.edges[e.id];
    if (!es?.taken) {
      out[e.id] = 'idle';
      continue;
    }
    const t = state.nodes[e.target];
    out[e.id] = alive && t && (t.status === 'running' || t.status === 'retrying') ? 'live' : 'done';
  }
  return out;
}