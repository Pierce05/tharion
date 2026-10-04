import { describe, expect, it } from 'vitest';
import { backoffMs } from '@tharion/engine';
import {
  cond,
  def,
  delay,
  edge,
  fastRetry,
  http,
  notify,
  output,
  resultOf,
  runWorkflow,
  transform,
  trigger,
  typesFor,
} from './helpers';

describe('linear execution (test 2)', () => {
  it('passes data correctly node to node', async () => {
    const wf = def(
      [trigger('t'), transform('a', '{"b": a + 1}'), transform('c', '{"c": b * 2}'), output('o', 'final')],
      [edge('t', 'a'), edge('a', 'c'), edge('c', 'o')],
    );
    const { state, events } = await runWorkflow(wf, { payload: { a: 1 } });
    expect(state.status).toBe('completed');
    expect(state.nodes.a.input).toEqual({ a: 1 });
    expect(state.nodes.a.output).toEqual({ b: 2 });
    expect(state.nodes.c.output).toEqual({ c: 4 });
    expect(state.edges['a:out->c']).toMatchObject({ resolved: true, taken: true, payload: { b: 2 } });
    expect(resultOf(events)).toEqual({ final: { c: 4 } });
    expect(events.filter((e) => e.type === 'NODE_SUCCEEDED').map((e) => e.nodeId)).toEqual(['t', 'a', 'c', 'o']);
  });

  it('renders http templates and echoes the body through the mock', async () => {
    const h = http('h', 'mock://ok/orders/{{id}}');
    if (h.type === 'http') h.config.body = '{"id": {{id}}}';
    const wf = def([trigger('t'), h, output('o')], [edge('t', 'h'), edge('h', 'o')]);
    const { state } = await runWorkflow(wf, { payload: { id: 42 } });
    const out = state.nodes.h.output as { status: number; body: { url: string; echo: unknown } };
    expect(out.status).toBe(200);
    expect(out.body.url).toBe('mock://ok/orders/42');
    expect(out.body.echo).toEqual({ id: 42 });
  });
});

describe('condition routing (test 3)', () => {
  const wf = def(
    [
      trigger('t'),
      cond('c', 'amount >= 10000'),
      transform('approve', '{"route": "approval", "amount": amount}'),
      output('oa', 'approved'),
      transform('auto', '{"route": "auto"}'),
      output('ob', 'auto'),
    ],
    [
      edge('t', 'c'),
      edge('c', 'approve', 'true'),
      edge('approve', 'oa'),
      edge('c', 'auto', 'false'),
      edge('auto', 'ob'),
    ],
  );

  it('takes the true branch and skips the false branch (propagated)', async () => {
    const { state, events } = await runWorkflow(wf, { payload: { amount: 20000 } });
    expect(state.status).toBe('completed');
    expect(state.nodes.approve.status).toBe('succeeded');
    expect(state.nodes.auto.status).toBe('skipped');
    expect(state.nodes.ob.status).toBe('skipped');
    expect(typesFor(events, 'ob')).toEqual(['NODE_SKIPPED']);
    expect(resultOf(events)).toEqual({ approved: { route: 'approval', amount: 20000 } });
  });

  it('takes the false branch and skips the true branch', async () => {
    const { state, events } = await runWorkflow(wf, { payload: { amount: 50 } });
    expect(state.nodes.approve.status).toBe('skipped');
    expect(state.nodes.oa.status).toBe('skipped');
    expect(resultOf(events)).toEqual({ auto: { route: 'auto' } });
  });
});

describe('parallel fan-out / fan-in (test 4)', () => {
  it('runs branches concurrently and merges inputs keyed by source node id', async () => {
    const wf = def(
      [
        trigger('t'),
        delay('da', 30),
        delay('db', 30),
        transform('ta', '{"x": n * 2}'),
        transform('tb', '{"y": n + 1}'),
        output('j', 'joined'),
      ],
      [edge('t', 'da'), edge('t', 'db'), edge('da', 'ta'), edge('db', 'tb'), edge('ta', 'j'), edge('tb', 'j')],
    );
    const { events, state } = await runWorkflow(wf, { payload: { n: 10 } });
    expect(resultOf(events)).toEqual({ joined: { ta: { x: 20 }, tb: { y: 11 } } });

    const idx = (type: string, nodeId: string): number => events.findIndex((e) => e.type === type && e.nodeId === nodeId);
    const bothStarted = Math.max(idx('NODE_STARTED', 'da'), idx('NODE_STARTED', 'db'));
    const firstDone = Math.min(idx('NODE_SUCCEEDED', 'da'), idx('NODE_SUCCEEDED', 'db'));
    expect(bothStarted).toBeLessThan(firstDone); // true concurrency
    expect(state.status).toBe('completed');
  });

  it('fan-in ignores branches that were not taken', async () => {
    const wf = def(
      [
        trigger('t'),
        cond('c', 'n > 5'),
        transform('x', '{"big": true}'),
        transform('y', '{"big": false}'),
        output('j', 'out'),
      ],
      [edge('t', 'c'), edge('c', 'x', 'true'), edge('c', 'y', 'false'), edge('x', 'j'), edge('y', 'j')],
    );
    const { events } = await runWorkflow(wf, { payload: { n: 1 } });
    expect(resultOf(events)).toEqual({ out: { y: { big: false } } });
  });
});

describe('retries (test 5)', () => {
  it('backoff policy math', () => {
    expect(backoffMs({ maxAttempts: 3, backoff: 'fixed', baseMs: 10 }, 2)).toBe(10);
    expect(backoffMs({ maxAttempts: 4, backoff: 'exponential', baseMs: 10 }, 1)).toBe(10);
    expect(backoffMs({ maxAttempts: 4, backoff: 'exponential', baseMs: 10 }, 3)).toBe(40);
  });

  it('succeeds on attempt 3 with mock://flaky', async () => {
    const wf = def([trigger('t'), http('h', 'mock://flaky', fastRetry(3)), output('o')], [edge('t', 'h'), edge('h', 'o')]);
    const { state, events } = await runWorkflow(wf);
    expect(state.status).toBe('completed');
    expect(state.nodes.h.attempt).toBe(3);
    expect(typesFor(events, 'h')).toEqual([
      'NODE_STARTED',
      'NODE_FAILED_ATTEMPT',
      'RETRY_SCHEDULED',
      'NODE_STARTED',
      'NODE_FAILED_ATTEMPT',
      'RETRY_SCHEDULED',
      'NODE_STARTED',
      'NODE_SUCCEEDED',
    ]);
  });

  it('mock://fail-once succeeds on attempt 2', async () => {
    const wf = def([trigger('t'), http('h', 'mock://fail-once', fastRetry(3)), output('o')], [edge('t', 'h'), edge('h', 'o')]);
    const { state } = await runWorkflow(wf);
    expect(state.status).toBe('completed');
    expect(state.nodes.h.attempt).toBe(2);
  });

  it('fails the run when retries are exhausted and schedules nothing downstream', async () => {
    const wf = def([trigger('t'), http('h', 'mock://flaky', fastRetry(2)), output('o')], [edge('t', 'h'), edge('h', 'o')]);
    const { state, events } = await runWorkflow(wf);
    expect(state.status).toBe('failed');
    expect(state.nodes.h.status).toBe('failed');
    expect(state.nodes.o.status).toBe('pending');
    expect(typesFor(events, 'h').slice(-2)).toEqual(['NODE_FAILED_ATTEMPT', 'NODE_FAILED']);
    const last = events[events.length - 1];
    expect(last?.type).toBe('RUN_FAILED');
  });

  it('lets in-flight siblings finish after a failure, but schedules nothing new', async () => {
    const wf = def(
      [trigger('t'), http('h', 'mock://flaky', fastRetry(1)), delay('d', 30), output('o2')],
      [edge('t', 'h'), edge('t', 'd'), edge('d', 'o2')],
    );
    const { state, events } = await runWorkflow(wf);
    expect(state.status).toBe('failed');
    expect(state.nodes.d.status).toBe('succeeded');
    expect(state.nodes.o2.status).toBe('pending');
    expect(events[events.length - 1]?.type).toBe('RUN_FAILED');
  });

  it('fault injection failNodes forces retries on an otherwise healthy node', async () => {
    const wf = def([trigger('t'), http('h', 'mock://ok', fastRetry(3)), output('o')], [edge('t', 'h'), edge('h', 'o')]);
    const { state } = await runWorkflow(wf, { faults: { failNodes: [{ nodeId: 'h', times: 1 }] } });
    expect(state.status).toBe('completed');
    expect(state.nodes.h.attempt).toBe(2);
  });
});

describe('notify effects', () => {
  const wf = def([trigger('t'), notify('n', 'Order {{id}} total {{total}}'), output('o')], [edge('t', 'n'), edge('n', 'o')]);

  it('writes exactly one outbox row with the rendered message', async () => {
    const { store, state } = await runWorkflow(wf, { payload: { id: 'A1', total: 5 } });
    expect(state.status).toBe('completed');
    expect(store.outbox).toHaveLength(1);
    expect(store.outbox[0]?.payload).toEqual({ message: 'Order A1 total 5' });
    expect(state.nodes.n.output).toEqual({ messageId: 'msg_run1_n' });
  });

  it('dry-run writes no effects', async () => {
    const { store, state } = await runWorkflow(wf, { payload: { id: 'A1', total: 5 }, dryRun: true });
    expect(store.outbox).toHaveLength(0);
    expect(state.nodes.n.output).toEqual({ messageId: 'dry-run' });
  });
});