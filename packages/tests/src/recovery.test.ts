import { describe, expect, it } from 'vitest';
import { MemoryStore, SimulatedCrash, executeRun, startRun } from '@tharion/engine';
import { def, edge, fastRetry, http, notify, output, resultOf, trigger, typesFor } from './helpers';

describe('engine-level recovery (resume from events)', () => {
  it('crash after effect: resume re-uses the recorded effect, outbox stays at 1 row', async () => {
    const workflow = def(
      [trigger('t'), notify('n', 'hello {{id}}'), output('o')],
      [edge('t', 'n'), edge('n', 'o')],
    );
    const store = new MemoryStore();
    startRun(store, { runId: 'run1', workflowVersion: 1, triggerPayload: { id: 7 } });

    await expect(
      executeRun({ store, workflow, runId: 'run1', faults: { crashAfterEffect: 'n' } }),
    ).rejects.toBeInstanceOf(SimulatedCrash);
    expect(store.outbox).toHaveLength(1);
    expect(typesFor(store.events('run1'), 'n')).toEqual(['NODE_STARTED']); // no terminal event

    const state = await executeRun({ store, workflow, runId: 'run1' }); // restart, no faults
    expect(state.status).toBe('completed');
    expect(store.outbox).toHaveLength(1);
    expect(state.nodes.n.attempt).toBe(2); // attempt counter continued, did not reset
    expect(state.nodes.n.output).toEqual({ messageId: 'msg_run1_n' });
  });

  it('a node with NODE_STARTED and no terminal event is re-executed with attempt + 1', async () => {
    const workflow = def([trigger('t'), output('o', 'out')], [edge('t', 'o')]);
    const store = new MemoryStore();
    startRun(store, { runId: 'run1', workflowVersion: 1, triggerPayload: { k: 1 } });
    store.append({ runId: 'run1', nodeId: 't', attempt: 1, type: 'NODE_STARTED', data: { input: { k: 1 } } });

    const state = await executeRun({ store, workflow, runId: 'run1' });
    const attempts = store
      .events('run1')
      .filter((e) => e.nodeId === 't')
      .map((e) => e.attempt);
    expect(attempts).toEqual([1, 2, 2]);
    expect(state.status).toBe('completed');
    expect(resultOf(store.events('run1'))).toEqual({ out: { k: 1 } });
  });

  it('honors a persisted retry delay after recovery (FR-E7)', async () => {
    const workflow = def(
      [trigger('t'), http('h', 'mock://fail-once', fastRetry(3)), output('o')],
      [edge('t', 'h'), edge('h', 'o')],
    );
    const store = new MemoryStore();
    startRun(store, { runId: 'run1', workflowVersion: 1, triggerPayload: {} });
    store.append({ runId: 'run1', nodeId: 't', attempt: 1, type: 'NODE_STARTED', data: { input: {} } });
    store.append({ runId: 'run1', nodeId: 't', attempt: 1, type: 'NODE_SUCCEEDED', data: { output: {}, durationMs: 0 } });
    store.append({ runId: 'run1', nodeId: 'h', attempt: 1, type: 'NODE_STARTED', data: { input: {} } });
    store.append({ runId: 'run1', nodeId: 'h', attempt: 1, type: 'NODE_FAILED_ATTEMPT', data: { error: 'boom' } });
    store.append({ runId: 'run1', nodeId: 'h', attempt: 1, type: 'RETRY_SCHEDULED', data: { at: Date.now() + 10_000 } });

    const sleeps: number[] = [];
    const state = await executeRun({
      store,
      workflow,
      runId: 'run1',
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(sleeps[0]).toBeGreaterThan(9000);
    expect(state.status).toBe('completed');
    expect(state.nodes.h.attempt).toBe(2);
  });
});