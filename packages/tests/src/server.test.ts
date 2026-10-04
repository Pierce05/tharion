import { afterEach, describe, expect, it } from 'vitest';
import { def, edge, output, transform, trigger } from './helpers';
import { boot, type Harness } from './harness';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const okWorkflow = def([trigger('t', { a: 1 }), transform('x', '{"b": a}'), output('o')], [edge('t', 'x'), edge('x', 'o')]);

describe('API', () => {
  it('rejects malformed bodies with 400 and never crashes', async () => {
    h = await boot();
    const bad = await h.api('POST', '/api/workflows', { name: 5 });
    expect(bad.status).toBe(400);
    const bad2 = await h.api('POST', '/api/workflows', { name: 'x', definition: { nodes: [{ id: 'n', type: 'nope' }], edges: [] } });
    expect(bad2.status).toBe(400);
    expect((await h.api('GET', '/api/health')).status).toBe(200);
  });

  it('save creates new versions; load returns latest or a specific version', async () => {
    h = await boot();
    const v1 = await h.api('POST', '/api/workflows', { id: 'wf1', name: 'one', definition: okWorkflow });
    expect(v1.json.version).toBe(1);
    const v2 = await h.api('PUT', '/api/workflows/wf1', { definition: def([trigger('t'), output('o')], [edge('t', 'o')]) });
    expect(v2.json.version).toBe(2);
    expect((await h.api('GET', '/api/workflows/wf1')).json.version).toBe(2);
    expect((await h.api('GET', '/api/workflows/wf1?version=1')).json.nodes).toHaveLength(3);
  });

  it('validate endpoint reports issues on a draft; run is blocked with 422', async () => {
    h = await boot();
    const cyclic = def([trigger('t'), transform('a', '$'), transform('b', '$')], [edge('t', 'a'), edge('a', 'b'), edge('b', 'a')]);
    const draft = await h.api('POST', '/api/workflows/new/validate', { definition: cyclic });
    expect(draft.json.valid).toBe(false);
    expect(draft.json.issues.map((i: { code: string }) => i.code)).toContain('CYCLE');

    const saved = await h.api('POST', '/api/workflows', { name: 'cyclic', definition: cyclic });
    const run = await h.api('POST', `/api/workflows/${saved.json.id}/runs`, {});
    expect(run.status).toBe(422);
    expect(run.json.details.issues.length).toBeGreaterThan(0);
  });

  it('GET run returns derived state and ordered events', async () => {
    h = await boot(); // no worker: the run stays queued
    const saved = await h.api('POST', '/api/workflows', { name: 'ok', definition: okWorkflow });
    const run = await h.api('POST', `/api/workflows/${saved.json.id}/runs`, { payload: { a: 7 } });
    const id = run.json.run.id;
    const detail = await h.api('GET', `/api/runs/${id}`);
    expect(detail.json.run.status).toBe('queued');
    expect(detail.json.state.status).toBe('running');
    const ev = await h.api('GET', `/api/runs/${id}/events`);
    expect(ev.json.events.map((e: { type: string }) => e.type)).toEqual(['RUN_STARTED']);
  });
});

describe('webhooks (test 12)', () => {
  it('dedupes on Idempotency-Key and creates distinct runs otherwise', async () => {
    h = await boot();
    const saved = await h.api('POST', '/api/workflows', { id: 'hook-wf', name: 'hook', definition: okWorkflow });
    const { token } = (await h.api('POST', `/api/workflows/${saved.json.id}/hook`)).json;
    expect(token).toMatch(/^wh_/);
    expect((await h.api('POST', `/api/workflows/${saved.json.id}/hook`)).json.token).toBe(token); // stable

    const first = await h.api('POST', `/api/hooks/${token}`, { a: 1 }, { 'Idempotency-Key': 'k1' });
    const second = await h.api('POST', `/api/hooks/${token}`, { a: 1 }, { 'Idempotency-Key': 'k1' });
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.json.deduped).toBe(true);
    expect(second.json.runId).toBe(first.json.runId);
    expect(h.db.prepare('SELECT COUNT(*) FROM runs').pluck().get()).toBe(1);
    expect(h.events(first.json.runId)).toHaveLength(1);

    const other = await h.api('POST', `/api/hooks/${token}`, { a: 1 }, { 'Idempotency-Key': 'k2' });
    expect(other.json.runId).not.toBe(first.json.runId);

    const n1 = await h.api('POST', `/api/hooks/${token}`, { a: 1 });
    const n2 = await h.api('POST', `/api/hooks/${token}`, { a: 1 });
    expect(n1.json.runId).not.toBe(n2.json.runId);
    expect(h.db.prepare('SELECT COUNT(*) FROM runs').pluck().get()).toBe(4);
  });

  it('unknown token is 404', async () => {
    h = await boot();
    expect((await h.api('POST', '/api/hooks/wh_nope', {})).status).toBe(404);
  });
});