import type { Json, RunState, WorkflowDefinition, WorkflowEdge, WorkflowNode } from './types';

export interface GraphIndex {
  nodes: Map<string, WorkflowNode>;
  inbound: Map<string, WorkflowEdge[]>;
  outbound: Map<string, WorkflowEdge[]>;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

export function indexGraph(def: WorkflowDefinition): GraphIndex {
  const nodes = new Map<string, WorkflowNode>();
  const inbound = new Map<string, WorkflowEdge[]>();
  const outbound = new Map<string, WorkflowEdge[]>();
  for (const n of def.nodes) nodes.set(n.id, n);
  for (const e of def.edges) {
    push(inbound, e.target, e);
    push(outbound, e.source, e);
  }
  return { nodes, inbound, outbound };
}

/** FR-E5: one inbound edge -> its payload; several -> { [sourceNodeId]: payload } of taken edges. */
export function nodeInput(idx: GraphIndex, state: RunState, node: WorkflowNode): Json {
  const inbound = idx.inbound.get(node.id) ?? [];
  if (inbound.length === 1) {
    const only = inbound[0] as WorkflowEdge;
    return state.edges[only.id]?.payload ?? null;
  }
  const merged: { [k: string]: Json } = {};
  for (const e of inbound) {
    const es = state.edges[e.id];
    if (es?.taken) merged[e.source] = es.payload ?? null;
  }
  return merged;
}

/**
 * FR-E3. `ready`: nodes to (re)execute: triggers, nodes whose inbound edges are all resolved
 * with at least one taken, plus nodes mid-retry or orphaned mid-attempt (resume).
 * `toSkip`: pending nodes whose inbound edges are all resolved but none taken.
 */
export function findReady(idx: GraphIndex, state: RunState): { ready: WorkflowNode[]; toSkip: WorkflowNode[] } {
  const ready: WorkflowNode[] = [];
  const toSkip: WorkflowNode[] = [];
  for (const node of idx.nodes.values()) {
    const ns = state.nodes[node.id];
    if (!ns) continue;
    if (ns.status === 'succeeded' || ns.status === 'failed' || ns.status === 'skipped') continue;
    if (ns.status === 'running' || ns.status === 'retrying') {
      ready.push(node);
      continue;
    }
    if (node.type === 'trigger') {
      ready.push(node);
      continue;
    }
    const inbound = idx.inbound.get(node.id) ?? [];
    if (inbound.length === 0) continue;
    if (!inbound.every((e) => state.edges[e.id]?.resolved)) continue;
    if (inbound.some((e) => state.edges[e.id]?.taken)) ready.push(node);
    else toSkip.push(node);
  }
  return { ready, toSkip };
}