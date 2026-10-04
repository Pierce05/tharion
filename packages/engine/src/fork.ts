import { indexGraph } from './graph';
import { reduce } from './reducer';
import type { NewEvent, RunEvent, WorkflowDefinition } from './types';

export function topologicalOrder(def: WorkflowDefinition): string[] {
  const idx = indexGraph(def);
  const indeg = new Map<string, number>(def.nodes.map((n) => [n.id, 0]));
  for (const e of def.edges) {
    if (indeg.has(e.source) && indeg.has(e.target)) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const queue = def.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const out: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    out.push(id);
    for (const e of idx.outbound.get(id) ?? []) {
      if (!indeg.has(e.target)) continue;
      const d = (indeg.get(e.target) ?? 0) - 1;
      indeg.set(e.target, d);
      if (d === 0) queue.push(e.target);
    }
  }
  return out;
}

/** All transitive ancestors of `nodeId` (excluding the node itself). */
export function upstreamOf(def: WorkflowDefinition, nodeId: string): Set<string> {
  const idx = indexGraph(def);
  const seen = new Set<string>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const e of idx.inbound.get(id) ?? []) {
      if (!seen.has(e.source)) {
        seen.add(e.source);
        stack.push(e.source);
      }
    }
  }
  return seen;
}

export type ForkPlan =
  | { ok: true; events: NewEvent[]; upstream: string[] }
  | { ok: false; code: 'NO_NODE' | 'UPSTREAM_INCOMPLETE'; error: string };

/**
 * FR-T3. Upstream nodes become NODE_REPLAYED (memoized output, no re-execution, no effects);
 * upstream nodes that were skipped in the parent stay skipped. Everything else executes in the fork.
 */
export function planFork(
  def: WorkflowDefinition,
  args: { parentRunId: string; runId: string; parentEvents: readonly RunEvent[]; atNodeId: string },
): ForkPlan {
  if (!def.nodes.some((n) => n.id === args.atNodeId)) {
    return { ok: false, code: 'NO_NODE', error: `node "${args.atNodeId}" is not in this workflow` };
  }
  const up = upstreamOf(def, args.atNodeId);
  const state = reduce(def, args.parentEvents);
  const events: NewEvent[] = [];
  const upstream: string[] = [];
  for (const id of topologicalOrder(def)) {
    if (!up.has(id)) continue;
    const ns = state.nodes[id];
    if (!ns) continue;
    if (ns.status === 'succeeded') {
      events.push({
        runId: args.runId,
        nodeId: id,
        attempt: null,
        type: 'NODE_REPLAYED',
        data: {
          fromRunId: args.parentRunId,
          input: ns.input ?? null,
          output: ns.output ?? null,
          ...(ns.handle ? { handle: ns.handle } : {}),
        },
      });
    } else if (ns.status === 'skipped') {
      events.push({ runId: args.runId, nodeId: id, attempt: null, type: 'NODE_SKIPPED', data: { reason: 'skipped in parent run' } });
    } else {
      return {
        ok: false,
        code: 'UPSTREAM_INCOMPLETE',
        error: `upstream node "${id}" is ${ns.status} in the parent run; fork from a node whose upstream completed`,
      };
    }
    upstream.push(id);
  }
  return { ok: true, events, upstream };
}