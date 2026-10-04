import { afterEach, describe, expect, it } from 'vitest';
import { def, delay, edge, notify, output, trigger } from './helpers';
import { boot, lastType, waitFor, type Harness } from './harness';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

describe('crash recovery with a real worker process', () => {
  it('kill -9 mid-run, restart, run completes, outbox has exactly 1 row (test 7)', { timeout: 45_000 }, async () => {
    h = await boot({ worker: true });
    const wf = def(
      [trigger('t', { id: 'A1' }), delay('d', 2500), notify('n', 'Order {{id}}'), output('o', 'done')],
      [edge('t', 'd'), edge('d', 'n'), edge('n', 'o')],
    );
    const saved = await h.api('POST', '/api/workflows', { name: 'chaos', definition: wf });
    expect(saved.status).toBe(201);
    const started = await h.api('POST', `/api/workflows/${saved.json.id}/runs`, { payload: { id: 'A1' } });
    expect(started.status).toBe(201);
    const runId: string = started.json.run.id;

    // wait until the delay node is mid-flight, then SIGKILL the worker
    await waitFor(() => h!.events(runId).some((e) => e.type === 'NODE_STARTED' && e.nodeId === 'd'));
    const kill = await h.api('POST', '/api/chaos/kill-worker');
    expect(kill.status).toBe(200);
    expect(kill.json.killed.id).toBe('w1');

    await waitFor(async () => (await h!.api('GET', '/api/system')).json.supervisor.alive === false);
    const sys = (await h.api('GET', '/api/system')).json;
    expect(sys.leases.some((l: { runId: string; owner: string }) => l.runId === runId && l.owner === 'w1')).toBe(true);
    expect(lastType(h.events(runId))).toBe('NODE_STARTED'); // stuck: no terminal event

    const restart = await h.api('POST', '/api/chaos/start-worker');
    expect(restart.status).toBe(201);
    expect(restart.json.started.id).toBe('w2');

    await waitFor(() => lastType(h!.events(runId)) === 'RUN_COMPLETED', 30_000);
    const events = h.events(runId);

    const recovered = events.find((e) => e.type === 'RUN_RECOVERED');
    expect(recovered?.type === 'RUN_RECOVERED' && recovered.data.workerId).toBe('w2');
    const delayAttempts = events.filter((e) => e.type === 'NODE_STARTED' && e.nodeId === 'd').map((e) => e.attempt);
    expect(delayAttempts).toEqual([1, 2]); // re-executed, counter did not reset
    expect(events.filter((e) => e.type === 'NODE_SUCCEEDED' && e.nodeId === 'n')).toHaveLength(1);

    const outbox = (await h.api('GET', '/api/outbox')).json;
    expect(outbox.count).toBe(1);
    expect(outbox.rows[0].payload).toEqual({ message: 'Order A1' });

    const detail = (await h.api('GET', `/api/runs/${runId}`)).json;
    expect(detail.state.status).toBe('completed');
  });

  it('SIGKILL between effect and commit: recovery finds the effect, outbox stays at 1 (test 8)', { timeout: 45_000 }, async () => {
    h = await boot({ worker: true });
    const wf = def([trigger('t', { id: 'B2' }), notify('n', 'Order {{id}}'), output('o', 'done')], [edge('t', 'n'), edge('n', 'o')]);
    const saved = await h.api('POST', '/api/workflows', { name: 'effect-crash', definition: wf });
    const started = await h.api('POST', `/api/workflows/${saved.json.id}/runs`, {
      payload: { id: 'B2' },
      faults: { crashAfterEffect: 'n' },
    });
    const runId: string = started.json.run.id;

    // the worker SIGKILLs itself after the effect is recorded and before NODE_SUCCEEDED commits
    await waitFor(() => !h!.supervisor.alive);
    const nTypes = (): string[] => h!.events(runId).filter((e) => e.nodeId === 'n').map((e) => e.type);
    expect(nTypes()).toEqual(['NODE_STARTED']);
    expect((await h.api('GET', '/api/outbox')).json.count).toBe(1); // the effect already happened

    await h.api('POST', '/api/chaos/start-worker');
    await waitFor(() => lastType(h!.events(runId)) === 'RUN_COMPLETED', 30_000);

    expect((await h.api('GET', '/api/outbox')).json.count).toBe(1); // no duplicate
    expect(nTypes()).toEqual(['NODE_STARTED', 'NODE_STARTED', 'NODE_SUCCEEDED']);
    const attempts = h.events(runId).filter((e) => e.nodeId === 'n').map((e) => e.attempt);
    expect(attempts).toEqual([1, 2, 2]);
  });
});