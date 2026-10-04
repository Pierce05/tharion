import type { Json } from '@tharion/engine';
import { api } from './api';
import { errMsg } from './format';
import { navigate } from './route';
import { markFork } from '../store/fx';
import { useUi } from '../store/ui';

const toast = (t: string): void => useUi.getState().showToast(t);

/** POST /runs/:id/fork, then jump to the new timeline. */
export async function forkAt(runId: string, atNodeId: string, inputOverride?: Json): Promise<boolean> {
  try {
    const r = await api.fork(runId, { atNodeId, ...(inputOverride !== undefined ? { inputOverride } : {}) });
    markFork();
    useUi.getState().setLastRun(r.run.id);
    navigate('rewind', r.run.id);
    toast(`A new timeline begins: ${r.run.id}`);
    return true;
  } catch (e) {
    toast(`Fork failed: ${errMsg(e)}`);
    return false;
  }
}