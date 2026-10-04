import { topologicalOrder } from './fork';
import { reduce } from './reducer';
import type { Json, NodeState, NodeStatus, RunEvent, RunStatus, WorkflowDefinition } from './types';

export function stableStringify(v: Json | undefined): string {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

export const jsonEqual = (a: Json | undefined, b: Json | undefined): boolean => stableStringify(a) === stableStringify(b);

export interface NodeSide {
  status: NodeStatus;
  attempt: number;
  replayed: boolean;
  input?: Json;
  output?: Json;
  error?: string;
}

export interface NodeDiff {
  nodeId: string;
  label: string;
  a: NodeSide;
  b: NodeSide;
  statusChanged: boolean;
  inputChanged: boolean;
  outputChanged: boolean;
  changed: boolean;
}

export interface RunDiff {
  statusA: RunStatus;
  statusB: RunStatus;
  nodes: NodeDiff[];
  /** First node, in topological order, whose input or output differs. */
  divergenceNodeId: string | null;
  resultA?: Json;
  resultB?: Json;
  resultChanged: boolean;
}

const side = (ns: NodeState): NodeSide => ({
  status: ns.status,
  attempt: ns.attempt,
  replayed: ns.replayed === true,
  input: ns.input,
  output: ns.output,
  error: ns.error,
});

function resultOf(events: readonly RunEvent[]): Json | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e && e.type === 'RUN_COMPLETED') return e.data.result;
  }
  return undefined;
}

/** FR-T4. Pure: compares two runs of the same workflow definition. */
export function diffRuns(def: WorkflowDefinition, eventsA: readonly RunEvent[], eventsB: readonly RunEvent[]): RunDiff {
  const sa = reduce(def, eventsA);
  const sb = reduce(def, eventsB);
  const labels = new Map(def.nodes.map((n) => [n.id, n.label]));
  const nodes: NodeDiff[] = [];
  let divergenceNodeId: string | null = null;
  for (const id of topologicalOrder(def)) {
    const na = sa.nodes[id];
    const nb = sb.nodes[id];
    if (!na || !nb) continue;
    const statusChanged = na.status !== nb.status;
    const inputChanged = !jsonEqual(na.input, nb.input);
    const outputChanged = !jsonEqual(na.output, nb.output);
    if (divergenceNodeId === null && (inputChanged || outputChanged)) divergenceNodeId = id;
    nodes.push({
      nodeId: id,
      label: labels.get(id) ?? id,
      a: side(na),
      b: side(nb),
      statusChanged,
      inputChanged,
      outputChanged,
      changed: statusChanged || inputChanged || outputChanged,
    });
  }
  const resultA = resultOf(eventsA);
  const resultB = resultOf(eventsB);
  return {
    statusA: sa.status,
    statusB: sb.status,
    nodes,
    divergenceNodeId,
    resultA,
    resultB,
    resultChanged: !jsonEqual(resultA, resultB),
  };
}

export interface DiffRow {
  kind: 'same' | 'add' | 'del';
  left: string | null;
  right: string | null;
}

/** Line-level LCS diff for side-by-side JSON views. */
export function lineDiff(a: string, b: string): DiffRow[] {
  const x = a.split('\n');
  const y = b.split('\n');
  const n = x.length;
  const m = y.length;
  if (n * m > 250_000) {
    return [
      ...x.map((l): DiffRow => ({ kind: 'del', left: l, right: null })),
      ...y.map((l): DiffRow => ({ kind: 'add', left: null, right: l })),
    ];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      rows.push({ kind: 'same', left: x[i], right: y[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: 'del', left: x[i], right: null });
      i++;
    } else {
      rows.push({ kind: 'add', left: null, right: y[j] });
      j++;
    }
  }
  while (i < n) rows.push({ kind: 'del', left: x[i++], right: null });
  while (j < m) rows.push({ kind: 'add', left: null, right: y[j++] });
  return rows;
}