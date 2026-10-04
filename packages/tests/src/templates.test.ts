import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  TEMPLATES,
  computeSamples,
  executeRun,
  hasErrors,
  startRun,
  validateWorkflow,
  type Json,
  type WorkflowDefinition,
} from '@tharion/engine';

function tpl(id: string): WorkflowDefinition {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`no template ${id}`);
  return t.definition;
}

async function run(def: WorkflowDefinition, payload: Json) {
  const store = new MemoryStore();
  startRun(store, { runId: 'r1', workflowVersion: 1, triggerPayload: payload });
  const state = await executeRun({ store, workflow: def, runId: 'r1', sleep: async () => undefined });
  return { store, state, events: store.events('r1') };
}

const order = (age: Json, amount: number): Json => ({ customer: { name: 'Aditi', age }, amount });

describe('built-in templates', () => {
  it.each(TEMPLATES.map((t) => [t.id]))('%s validates without errors or warnings', async (id) => {
    const issues = await validateWorkflow(tpl(id as string));
    expect(issues).toEqual([]);
    expect(hasErrors(issues)).toBe(false);
  });

  it('Order Intake, approval path: retry on fetch, 2 outbox rows, adult=true', async () => {
    const { store, state, events } = await run(tpl('order-intake'), order(34, 12000));
    expect(state.status).toBe('completed');
    expect(state.nodes.fetch_customer.attempt).toBe(2); // mock://fail-once
    expect(state.nodes.auto_process.status).toBe('skipped');
    expect(state.nodes.compose.output).toMatchObject({ to: 'Aditi', isAdult: true, route: 'approval' });
    expect(store.outbox.map((o) => o.nodeId).sort()).toEqual(['notify_customer', 'request_approval']);
    expect(events[events.length - 1]?.type).toBe('RUN_COMPLETED');
  });

  it('Order Intake, auto path: approval skipped, 1 outbox row', async () => {
    const { store, state } = await run(tpl('order-intake'), order(34, 50));
    expect(state.status).toBe('completed');
    expect(state.nodes.request_approval.status).toBe('skipped');
    expect(state.nodes.compose.output).toMatchObject({ route: 'auto' });
    expect(store.outbox).toHaveLength(1);
  });

  it('Order Intake with age "twenty" fails at Compose after 3 attempts, no customer notification', async () => {
    const { store, state } = await run(tpl('order-intake'), order('twenty', 12000));
    expect(state.status).toBe('failed');
    expect(state.nodes.normalize.output).toMatchObject({ isAdult: null });
    expect(state.nodes.compose.status).toBe('failed');
    expect(state.nodes.compose.attempt).toBe(3);
    expect(state.nodes.compose.error).toMatch(/isAdult is null/);
    expect(state.nodes.notify_customer.status).toBe('pending');
    expect(store.outbox.map((o) => o.nodeId)).toEqual(['request_approval']);
  });

  it('Flaky API Pipeline recovers on attempt 2', async () => {
    const { state } = await run(tpl('flaky-api'), { id: 42 });
    expect(state.status).toBe('completed');
    expect(state.nodes.fetch.attempt).toBe(2);
    expect(state.nodes.shape.output).toEqual({ status: 200, ok: true, id: 42 });
  });

  it('Age Gate: "twenty" is blocked (isAdult null), 20 is adult (isAdult true)', async () => {
    const a = await run(tpl('age-gate'), { customer: { name: 'Aditi', age: 'twenty' } });
    expect(a.state.nodes.normalize.output).toEqual({ name: 'Aditi', isAdult: null });
    expect(a.state.nodes.out_blocked.status).toBe('succeeded');
    expect(a.state.nodes.out_adult.status).toBe('skipped');

    const b = await run(tpl('age-gate'), { customer: { name: 'Aditi', age: 20 } });
    expect(b.state.nodes.normalize.output).toEqual({ name: 'Aditi', isAdult: true });
    expect(b.state.nodes.out_adult.status).toBe('succeeded');
  });

  it('computeSamples previews the whole Order Intake graph from the trigger sample', async () => {
    const s = await computeSamples(tpl('order-intake'));
    expect(s.normalize?.output).toMatchObject({ amount: 12000, isAdult: true });
    expect(s.condition?.rendered).toBe('expression → true');
    expect(s.compose?.output).toMatchObject({ to: 'Aditi' });
    expect(s.compose?.error).toBeUndefined();
  });
});