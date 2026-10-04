import { TEMPLATES, blankDefinition, cloneDefinition, hasErrors, type JsonObject, type WorkflowDefinition } from '@tharion/engine';
import { api } from './api';
import { errMsg } from './format';
import { navigate, type Mode } from './route';
import { selectDirty, useWorkflow } from '../store/workflow';
import { useUi } from '../store/ui';

const toast = (t: string): void => useUi.getState().showToast(t);

export async function saveWorkflow(): Promise<void> {
  const s = useWorkflow.getState();
  if (!s.id) return;
  if (!selectDirty(s)) return toast('Nothing to save');
  try {
    const wf = await s.save();
    if (wf) toast(`Saved as v${wf.version}`);
  } catch (e) {
    toast(`Save failed: ${errMsg(e)}`);
  }
}

export async function createWorkflow(name: string, def: WorkflowDefinition): Promise<void> {
  try {
    const id = await useWorkflow.getState().create(name, def);
    useUi.getState().closeModal();
    navigate('build', id);
    toast(`Created "${name}"`);
  } catch (e) {
    toast(`Could not create workflow: ${errMsg(e)}`);
  }
}

export const newFromTemplate = (templateId: string): Promise<void> => {
  const t = TEMPLATES.find((x) => x.id === templateId);
  return t ? createWorkflow(t.name, cloneDefinition(t.definition)) : Promise.resolve();
};

export const newBlank = (): Promise<void> => createWorkflow('Untitled workflow', blankDefinition());

export function duplicateWorkflow(): Promise<void> {
  const s = useWorkflow.getState();
  if (!s.id) return Promise.resolve();
  return createWorkflow(`${s.name} copy`, cloneDefinition({ nodes: s.nodes, edges: s.edges }));
}

export function openWorkflow(id: string): void {
  useUi.getState().closeModal();
  navigate('build', id);
}

export function exportWorkflow(): void {
  const s = useWorkflow.getState();
  if (!s.id) return;
  const blob = new Blob([JSON.stringify({ name: s.name, version: s.version, nodes: s.nodes, edges: s.edges }, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${s.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'workflow'}.tharion.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exported workflow JSON');
}

export async function importWorkflowText(text: string): Promise<void> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    const o = parsed as { name?: unknown; nodes?: unknown; edges?: unknown };
    if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) throw new Error('expected { nodes: [], edges: [] }');
    const name = typeof o.name === 'string' && o.name ? o.name : 'Imported workflow';
    await createWorkflow(name, { nodes: o.nodes, edges: o.edges } as WorkflowDefinition);
  } catch (e) {
    toast(`Import failed: ${errMsg(e)}`);
  }
}

export async function startRun(): Promise<void> {
  const first = useWorkflow.getState();
  if (!first.id) return;
  if (hasErrors(first.issues)) return toast('Fix validation errors first');
  try {
    if (selectDirty(first)) await first.save();
    const s = useWorkflow.getState();
    const trig = s.nodes.find((n) => n.type === 'trigger');
    const sample = trig && trig.type === 'trigger' ? trig.config.samplePayload : {};
    const payload: JsonObject = typeof sample === 'object' && sample !== null && !Array.isArray(sample) ? sample : {};
    const { run } = await api.startRun(first.id, { payload });
    useUi.getState().setLastRun(run.id);
    navigate('run', run.id);
  } catch (e) {
    toast(`Run failed to start: ${errMsg(e)}`);
  }
}

export function goMode(mode: Mode): void {
  if (mode === 'build') return navigate('build', useWorkflow.getState().id);
  navigate(mode, useUi.getState().lastRunId);
}