import { evaluateExpression, expressionError, templateExpressions } from './expr';
import { assignable, describeType, inputPort, outputPort, validSourceHandles } from './ports';
import type {
  Json,
  Severity,
  ValidationIssue,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from './types';
import { errorMessage } from './util';

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

function topo(nodeIds: string[], edges: WorkflowEdge[]): { order: string[]; cyclic: string[] } {
  const indeg = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const out = new Map<string, string[]>();
  for (const e of edges) {
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    const l = out.get(e.source);
    if (l) l.push(e.target);
    else out.set(e.source, [e.target]);
  }
  const queue = nodeIds.filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const t of out.get(id) ?? []) {
      const d = (indeg.get(t) ?? 0) - 1;
      indeg.set(t, d);
      if (d === 0) queue.push(t);
    }
  }
  // leftover = on a cycle or downstream of one; prune nodes that only lead out of the cycle
  const left = new Set(nodeIds.filter((id) => !order.includes(id)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...left]) {
      if (!(out.get(id) ?? []).some((t) => left.has(t))) {
        left.delete(id);
        changed = true;
      }
    }
  }
  return { order, cyclic: [...left] };
}

async function sampleOutput(node: WorkflowNode, input: Json | undefined): Promise<Json | undefined> {
  switch (node.type) {
    case 'trigger':
      return node.config.samplePayload;
    case 'transform':
      if (input === undefined) return undefined;
      try {
        return await evaluateExpression(node.config.expression, input);
      } catch {
        return undefined;
      }
    case 'condition':
    case 'delay':
    case 'output':
      return input;
    default:
      return undefined; // http, notify: unknown without executing
  }
}

export async function validateWorkflow(def: WorkflowDefinition): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const push = (
    severity: Severity,
    code: string,
    message: string,
    extra: { nodeId?: string; edgeId?: string; fixHint?: string } = {},
  ): void => {
    issues.push({ code, severity, message, ...extra });
  };

  const byId = new Map<string, WorkflowNode>();
  for (const n of def.nodes) {
    if (byId.has(n.id)) push('error', 'DUPLICATE_NODE_ID', `Duplicate node id "${n.id}"`, { nodeId: n.id });
    else byId.set(n.id, n);
  }

  // Edge structure
  const good: WorkflowEdge[] = [];
  for (const e of def.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) {
      push('error', 'EDGE_DANGLING', `Edge ${e.id} connects to a node that does not exist`, { edgeId: e.id });
      continue;
    }
    if (!validSourceHandles(s).includes(e.sourceHandle)) {
      push('error', 'EDGE_BAD_HANDLE', `"${s.label}" has no "${e.sourceHandle}" output`, { edgeId: e.id, nodeId: s.id });
      continue;
    }
    if (t.type === 'trigger') {
      push('error', 'TRIGGER_INBOUND', `Trigger "${t.label}" cannot have inbound edges`, {
        edgeId: e.id,
        nodeId: t.id,
        fixHint: 'Remove the edge pointing into the trigger',
      });
      continue;
    }
    if (e.targetHandle !== 'in') {
      push('error', 'EDGE_BAD_HANDLE', `"${t.label}" has no "${e.targetHandle}" input`, { edgeId: e.id, nodeId: t.id });
      continue;
    }
    good.push(e);
  }

  // 1. triggers
  const triggers = def.nodes.filter((n) => n.type === 'trigger');
  if (triggers.length === 0) {
    push('error', 'NO_TRIGGER', 'Workflow has no trigger', { fixHint: 'Add a manual or webhook trigger' });
  }

  // 2. acyclic
  const { order, cyclic } = topo([...byId.keys()], good);
  if (cyclic.length > 0) {
    const names = cyclic.map((id) => byId.get(id)?.label ?? id).join(' → ');
    push('error', 'CYCLE', `Workflow contains a cycle: ${names}`, {
      nodeId: cyclic[0],
      fixHint: 'Remove one edge to break the cycle',
    });
  }

  // 3. reachability from triggers
  const out = new Map<string, string[]>();
  for (const e of good) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  const seen = new Set<string>(triggers.map((t) => t.id));
  const stack = [...seen];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const t of out.get(id) ?? []) {
      if (!seen.has(t)) {
        seen.add(t);
        stack.push(t);
      }
    }
  }
  for (const n of byId.values()) {
    if (n.type !== 'trigger' && !seen.has(n.id)) {
      push('error', 'UNREACHABLE', `"${n.label}" is not reachable from any trigger`, {
        nodeId: n.id,
        fixHint: 'Connect it to a node downstream of a trigger',
      });
    }
  }

  // 4. edge type compatibility
  for (const e of good) {
    const s = byId.get(e.source) as WorkflowNode;
    const t = byId.get(e.target) as WorkflowNode;
    const sp = outputPort(s);
    const tp = inputPort(t);
    if (!sp || !tp) continue;
    const reason = assignable(sp, tp);
    if (reason) {
      push('error', 'EDGE_TYPE', `Cannot connect "${s.label}" (${describeType(sp)}) to "${t.label}" (expects ${describeType(tp)}): ${reason}`, {
        edgeId: e.id,
        fixHint: 'Insert a transform that produces the expected type',
      });
    }
  }

  // 5/6. expressions + templates
  const checkExpr = (node: WorkflowNode, field: string, expr: string, code = 'JSONATA_PARSE'): boolean => {
    const msg = expressionError(expr);
    if (msg) {
      push('error', code, `"${node.label}" ${field} is not valid JSONata: ${msg}`, { nodeId: node.id });
      return false;
    }
    return true;
  };
  const parsedConditions = new Set<string>();
  for (const n of byId.values()) {
    switch (n.type) {
      case 'transform':
        checkExpr(n, 'expression', n.config.expression);
        break;
      case 'condition':
        if (checkExpr(n, 'expression', n.config.expression, 'COND_PARSE')) parsedConditions.add(n.id);
        break;
      case 'http':
        for (const x of templateExpressions(n.config.url)) checkExpr(n, 'url template', x);
        for (const x of templateExpressions(n.config.body ?? '')) checkExpr(n, 'body template', x);
        break;
      case 'notify':
        for (const x of templateExpressions(n.config.template)) checkExpr(n, 'template', x);
        break;
      default:
        break;
    }
  }

  // 5. condition returns boolean on sample data (samples propagate through pure nodes only)
  if (cyclic.length === 0 && parsedConditions.size > 0) {
    const samples = new Map<string, Json | undefined>();
    const inputs = new Map<string, Json | undefined>();
    for (const id of order) {
      const n = byId.get(id) as WorkflowNode;
      let input: Json | undefined;
      if (n.type !== 'trigger') {
        const inc = good.filter((e) => e.target === id);
        if (inc.length === 1) input = samples.get((inc[0] as WorkflowEdge).source);
        else if (inc.length > 1) {
          const merged: { [k: string]: Json } = {};
          let known = true;
          for (const e of inc) {
            const v = samples.get(e.source);
            if (v === undefined) {
              known = false;
              break;
            }
            merged[e.source] = v;
          }
          input = known ? merged : undefined;
        }
      }
      inputs.set(id, input);
      samples.set(id, await sampleOutput(n, input));
    }
    for (const id of parsedConditions) {
      const n = byId.get(id) as WorkflowNode;
      const input = inputs.get(id);
      if (n.type !== 'condition' || input === undefined) continue;
      try {
        const r = await evaluateExpression(n.config.expression, input);
        if (r !== null && typeof r !== 'boolean') {
          push('error', 'COND_NOT_BOOLEAN', `"${n.label}" returns ${typeof r} on sample data, expected boolean`, {
            nodeId: id,
            fixHint: 'Use a comparison, e.g. amount >= 100',
          });
        }
      } catch (e) {
        push('error', 'COND_EVAL', `"${n.label}" failed on sample data: ${errorMessage(e)}`, { nodeId: id });
      }
    }
  }

  // 7/8. warnings
  if (!def.nodes.some((n) => n.type === 'output')) {
    push('warning', 'NO_OUTPUT', 'Workflow has no output node', { fixHint: 'Add an output node to capture the result' });
  }
  const hasOutbound = new Set(good.map((e) => e.source));
  for (const n of byId.values()) {
    if (n.type !== 'output' && n.type !== 'notify' && !hasOutbound.has(n.id)) {
      push('warning', 'ORPHAN_OUTPUT', `"${n.label}" output is never consumed`, { nodeId: n.id });
    }
  }

  return issues;
}