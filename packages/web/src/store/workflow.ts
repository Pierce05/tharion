import { create } from 'zustand';
import {
  computeSamples,
  validSourceHandles,
  validateWorkflow,
  type Handle,
  type NodeSample,
  type NodeType,
  type Position,
  type ValidationIssue,
  type Workflow,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from '@tharion/engine';
import { api } from '../lib/api';
import { makeNode, nextPosition, uniqueId } from '../lib/defaults';
import { errMsg } from '../lib/format';
import { navigate } from '../lib/route';
import { useUi } from './ui';

export type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
export const LAST_KEY = 'tharion:wf';

const snapshot = (name: string, nodes: WorkflowNode[], edges: WorkflowEdge[]): string => JSON.stringify([name, nodes, edges]);

interface WorkflowStore {
  id: string | null;
  name: string;
  version: number | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  baseline: string;
  loadState: LoadState;
  loadError: string | null;
  selectedNodeId: string | null;
  issues: ValidationIssue[];
  samples: Record<string, NodeSample>;
  saving: boolean;
  epoch: number;

  bootstrap: (routeId: string | null) => Promise<void>;
  load: (id: string, version?: number) => Promise<void>;
  create: (name: string, def: WorkflowDefinition) => Promise<string>;
  save: () => Promise<Workflow | null>;
  rename: (name: string) => void;
  select: (id: string | null) => void;
  addNode: (type: NodeType, position?: Position) => void;
  updateNode: (id: string, fn: (n: WorkflowNode) => WorkflowNode) => void;
  moveNode: (id: string, position: Position) => void;
  removeNodes: (ids: string[]) => void;
  removeEdges: (ids: string[]) => void;
  connect: (c: { source: string; sourceHandle: Handle; target: string }) => string | null;
  replaceDefinition: (def: WorkflowDefinition, name?: string) => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

function scheduleValidate(): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const my = ++seq;
    const { nodes, edges } = useWorkflow.getState();
    const def: WorkflowDefinition = { nodes, edges };
    Promise.all([validateWorkflow(def), computeSamples(def)])
      .then(([issues, samples]) => {
        if (my === seq) useWorkflow.setState({ issues, samples });
      })
      .catch((e: unknown) => console.error('[validate]', e));
  }, 120);
}

export const useWorkflow = create<WorkflowStore>((set, get) => {
  const applyLoaded = (wf: Workflow): void => {
    set({
      id: wf.id,
      name: wf.name,
      version: wf.version,
      nodes: wf.nodes,
      edges: wf.edges,
      baseline: snapshot(wf.name, wf.nodes, wf.edges),
      loadState: 'ready',
      loadError: null,
      selectedNodeId: null,
      issues: [],
      samples: {},
    });
    try {
      localStorage.setItem(LAST_KEY, wf.id);
    } catch {
      /* storage unavailable */
    }
    scheduleValidate();
  };

  return {
    id: null,
    name: '',
    version: null,
    nodes: [],
    edges: [],
    baseline: '',
    loadState: 'idle',
    loadError: null,
    selectedNodeId: null,
    issues: [],
    samples: {},
    saving: false,
    epoch: 0,

    async bootstrap(routeId) {
      const s = get();
      if (routeId) {
        if (s.id === routeId && s.loadState === 'ready') return;
        await get().load(routeId);
        return;
      }
      if (s.id && s.loadState === 'ready') {
        navigate('build', s.id, true);
        return;
      }
      set({ loadState: 'loading', loadError: null });
      try {
        const { workflows } = await api.listWorkflows();
        let last: string | null = null;
        try {
          last = localStorage.getItem(LAST_KEY);
        } catch {
          last = null;
        }
        const target = workflows.find((w) => w.id === last) ?? workflows[0];
        if (!target) {
          set({ loadState: 'empty', id: null, nodes: [], edges: [] });
          return;
        }
        navigate('build', target.id, true);
      } catch (e) {
        set({ loadState: 'error', loadError: errMsg(e) });
      }
    },

    async load(id, version) {
      set({ loadState: 'loading', loadError: null });
      try {
        applyLoaded(await api.getWorkflow(id, version));
      } catch (e) {
        set({ loadState: 'error', loadError: errMsg(e) });
      }
    },

    async create(name, def) {
      const wf = await api.createWorkflow(name, def);
      applyLoaded(wf);
      return wf.id;
    },

    async save() {
      const s = get();
      if (!s.id) return null;
      set({ saving: true });
      try {
        const wf = await api.saveWorkflow(s.id, s.name, { nodes: s.nodes, edges: s.edges });
        set({ version: wf.version, baseline: snapshot(s.name, s.nodes, s.edges) });
        return wf;
      } finally {
        set({ saving: false });
      }
    },

    rename: (name) => set({ name }),
    select: (selectedNodeId) => set({ selectedNodeId }),

    replaceDefinition(def, name) {
        set((s) => ({ nodes: def.nodes, edges: def.edges, name: name ?? s.name, selectedNodeId: null, epoch: s.epoch + 1 }));
        scheduleValidate();
    },

    addNode(type, position) {
      const s = get();
      const id = uniqueId(type, s.nodes);
      set({ nodes: [...s.nodes, makeNode(type, id, position ?? nextPosition(s.nodes))], selectedNodeId: id });
      scheduleValidate();
    },

    updateNode(id, fn) {
      set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? fn(n) : n)) }));
      scheduleValidate();
    },

    moveNode(id, position) {
      set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, position } : n)) }));
    },

    removeNodes(ids) {
      const gone = new Set(ids);
      set((s) => ({
        nodes: s.nodes.filter((n) => !gone.has(n.id)),
        edges: s.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
        selectedNodeId: s.selectedNodeId && gone.has(s.selectedNodeId) ? null : s.selectedNodeId,
      }));
      scheduleValidate();
    },

    removeEdges(ids) {
      const gone = new Set(ids);
      set((s) => ({ edges: s.edges.filter((e) => !gone.has(e.id)) }));
      scheduleValidate();
    },

    connect({ source, sourceHandle, target }) {
      const { nodes, edges } = get();
      const s = nodes.find((n) => n.id === source);
      const t = nodes.find((n) => n.id === target);
      if (!s || !t) return 'Unknown node';
      if (s.id === t.id) return 'A node cannot connect to itself';
      if (t.type === 'trigger') return 'Triggers cannot have inbound edges';
      if (!validSourceHandles(s).includes(sourceHandle)) return `"${s.label}" has no "${sourceHandle}" output`;
      const id = `${source}:${sourceHandle}->${target}`;
      if (edges.some((e) => e.id === id)) return 'Already connected';
      set({ edges: [...edges, { id, source, sourceHandle, target, targetHandle: 'in' }] });
      scheduleValidate();
      return null;
    },
  };
});

export const selectDirty = (s: WorkflowStore): boolean => s.loadState === 'ready' && snapshot(s.name, s.nodes, s.edges) !== s.baseline;

export function useDirty(): boolean {
  return useWorkflow(selectDirty);
}

export const useWorkflowToast = (text: string): void => useUi.getState().showToast(text);