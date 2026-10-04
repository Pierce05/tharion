import type { JsonObject } from '@tharion/engine';
import { ApiError, api } from './api';
import { errMsg } from './format';
import { navigate } from './route';
import { toFaults, useRunConfig } from '../store/runConfig';
import { useUi } from '../store/ui';

const toast = (t: string): void => useUi.getState().showToast(t);

export function parsePayload(text: string): { ok: true; value: JsonObject } | { ok: false; error: string } {
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false, error: 'payload must be a JSON object' };
    return { ok: true, value: v as JsonObject };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Starts a run of the latest saved version using the payload / dry-run / one-shot faults from the Run header. */
export async function launchRun(workflowId: string): Promise<boolean> {
  const cfg = useRunConfig.getState();
  const p = parsePayload(cfg.payloadText);
  if (!p.ok) {
    toast(`Trigger payload: ${p.error}`);
    return false;
  }
  try {
    const { run } = await api.startRun(workflowId, { payload: p.value, dryRun: cfg.dryRun, faults: toFaults(cfg) });
    cfg.clearFaults();
    useUi.getState().setLastRun(run.id);
    navigate('run', run.id);
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) toast('Workflow has validation errors. Fix them in Build.');
    else toast(`Run failed to start: ${errMsg(e)}`);
    return false;
  }
}

export async function killWorker(): Promise<void> {
  try {
    const r = await api.killWorker();
    useUi.getState().fireFlash();
    toast(`SIGKILL sent to ${r.killed.id} (pid ${r.killed.pid})`);
  } catch (e) {
    toast(errMsg(e));
  }
}

export async function startWorker(): Promise<void> {
  try {
    const r = await api.startWorker();
    toast(`Started worker ${r.started.id} (pid ${r.started.pid})`);
  } catch (e) {
    toast(errMsg(e));
  }
}

export async function setAutoRestart(enabled: boolean): Promise<void> {
  try {
    await api.setAutoRestart(enabled);
    toast(`Auto-restart ${enabled ? 'on' : 'off'}`);
  } catch (e) {
    toast(errMsg(e));
  }
}

/** FR-C3 duplicateWebhook: the same delivery twice with one Idempotency-Key must create one run. */
export async function fireDuplicateWebhook(workflowId: string): Promise<void> {
  const p = parsePayload(useRunConfig.getState().payloadText);
  if (!p.ok) return toast(`Trigger payload: ${p.error}`);
  try {
    const { token } = await api.hookToken(workflowId);
    const key = `dup-${Date.now().toString(36)}`;
    const a = await api.fireHook(token, p.value, key);
    const b = await api.fireHook(token, p.value, key);
    toast(a.runId === b.runId && b.deduped ? `Delivered twice with key ${key} → 1 run (deduped)` : 'Unexpected: duplicate delivery created 2 runs');
    useUi.getState().setLastRun(a.runId);
    navigate('run', a.runId);
  } catch (e) {
    toast(`Webhook failed: ${errMsg(e)}`);
  }
}