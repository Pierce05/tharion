import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  SimulatedCrash,
  deliveryProof,
  eventLevel,
  executeRun,
  filterEvents,
  lastRecovery,
  startRun,
} from '@tharion/engine';
import { def, edge, fastRetry, http, notify, output, trigger } from './helpers';

describe('log helpers', () => {
  it('filters by node, minimum level and case-insensitive search', async () => {
    const wf = def([trigger('t'), http('h', 'mock://flaky', fastRetry(3)), output('o')], [edge('t', 'h'), edge('h', 'o')]);
    const store = new MemoryStore();
    startRun(store, { runId: 'r', workflowVersion: 1, triggerPayload: {} });
    await executeRun({ store, workflow: wf, runId: 'r', sleep: async () => undefined });
    const events = store.events('r');

    expect(filterEvents(events, { level: 'error' }).map((e) => e.type)).toEqual(['NODE_FAILED_ATTEMPT', 'NODE_FAILED_ATTEMPT']);
    expect(filterEvents(events, { level: 'warn' })).toHaveLength(4); // 2 failed attempts + 2 retries
    const onlyH = filterEvents(events, { nodeId: 'h' });
    expect(onlyH.length).toBeGreaterThan(0);
    expect(onlyH.every((e) => e.nodeId === 'h')).toBe(true);
    expect(filterEvents(events, { query: 'FAILED (ATTEMPT' })).toHaveLength(2);
    expect(filterEvents(events, {})).toHaveLength(events.length);
  });

  it('classifies recovery as a warning', () => {
    const store = new MemoryStore();
    const ev = store.append({ runId: 'r', nodeId: null, attempt: null, type: 'RUN_RECOVERED', data: { workerId: 'w2' } });
    expect(eventLevel(ev)).toBe('warn');
    expect(lastRecovery([ev])).toMatchObject({ workerId: 'w2', seq: ev.seq });
    expect(lastRecovery([])).toBeNull();
  });

  it('delivery proof after a crash: 2 attempts started, exactly 1 outbox row, stable key', async () => {
    const wf = def([trigger('t', { id: 7 }), notify('n', 'hi {{id}}'), output('o')], [edge('t', 'n'), edge('n', 'o')]);
    const store = new MemoryStore();
    startRun(store, { runId: 'run1', workflowVersion: 1, triggerPayload: { id: 7 } });
    await expect(executeRun({ store, workflow: wf, runId: 'run1', faults: { crashAfterEffect: 'n' } })).rejects.toBeInstanceOf(SimulatedCrash);
    await executeRun({ store, workflow: wf, runId: 'run1' });

    expect(deliveryProof(store.events('run1'), store.outbox, 'run1')).toEqual([
      { nodeId: 'n', key: 'run1:n', attempts: 2, rows: 1 },
    ]);
    expect(deliveryProof(store.events('run1'), store.outbox, 'other-run')).toEqual([]);
  });
});