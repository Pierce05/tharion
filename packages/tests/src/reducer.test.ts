import { describe, expect, it } from 'vitest';
import { MemoryStore, executeRun, reduce, startRun, type RunState } from '@tharion/engine';
import { cond, def, delay, edge, fastRetry, http, output, transform, trigger, deepFreeze } from './helpers';

const wf = def(
  [
    trigger('t'),
    cond('c', 'n > 5'),
    transform('x', '{"v": n}'),
    transform('y', '{"v": 0}'),
    delay('d', 5),
    http('h', 'mock://flaky', fastRetry(3)),
    output('o', 'out'),
  ],
  [
    edge('t', 'c'),
    edge('c', 'x', 'true'),
    edge('c', 'y', 'false'),
    edge('x', 'd'),
    edge('y', 'd'),
    edge('d', 'h'),
    edge('h', 'o'),
  ],
);

describe('reducer (test 6)', () => {
  it('is deterministic and does not mutate its input', async () => {
    const store = new MemoryStore();
    startRun(store, { runId: 'run1', workflowVersion: 1, triggerPayload: { n: 9 } });
    await executeRun({ store, workflow: wf, runId: 'run1' });
    const events = deepFreeze(store.events('run1'));

    const a = reduce(wf, events);
    const b = reduce(wf, events);
    expect(a).toEqual(b);
    expect(a.status).toBe('completed');
    expect(a.cursor).toBe(events.length);
  });

  it('replaying any prefix equals the live state at that point', async () => {
    const store = new MemoryStore();
    const live: RunState[] = [];
    store.onAppend = () => live.push(reduce(wf, store.events('run1')));
    startRun(store, { runId: 'run1', workflowVersion: 1, triggerPayload: { n: 2 } });
    const final = await executeRun({ store, workflow: wf, runId: 'run1' });
    const events = store.events('run1');

    expect(live).toHaveLength(events.length);
    for (let i = 1; i <= events.length; i++) {
      const prefix = reduce(wf, events, i);
      expect(prefix.cursor).toBe(i);
      expect(prefix).toEqual(live[i - 1]);
      expect(prefix).toEqual(reduce(wf, events.slice(0, i)));
    }
    expect(reduce(wf, events)).toEqual(final);
  });

  it('an empty log is a queued run with every node pending', () => {
    const s = reduce(wf, []);
    expect(s.status).toBe('queued');
    expect(Object.values(s.nodes).every((n) => n.status === 'pending')).toBe(true);
    expect(Object.values(s.edges).every((e) => !e.resolved)).toBe(true);
  });
});