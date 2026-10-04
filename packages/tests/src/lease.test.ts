import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LeaseLostError, SqliteStore, claimRun, createRun, getRun, openDb, saveWorkflow, type Db } from '@tharion/db';
import { createWorker } from '@tharion/worker';
import { def, delay, edge, output, trigger } from './helpers';
import { waitFor } from './harness';

const dirs: string[] = [];
const dbs: Db[] = [];
afterEach(() => {
  while (dbs.length) dbs.pop()?.close();
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function setup(): { db: Db; dbPath: string; runId: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tharion-lease-'));
  dirs.push(dir);
  const dbPath = join(dir, 'l.db');
  const db = openDb(dbPath);
  dbs.push(db);
  const wf = def([trigger('t'), delay('d1', 200), delay('d2', 200), output('o')], [edge('t', 'd1'), edge('d1', 'd2'), edge('d2', 'o')]);
  saveWorkflow(db, { id: 'wf', name: 'lease', definition: wf });
  const { run } = createRun(db, { workflowId: 'wf', workflowVersion: 1, triggerPayload: {}, dryRun: false, faults: null });
  return { db, dbPath, runId: run.id };
}

describe('lease contention (test 9)', () => {
  it('two workers, one run: exactly one executes it', async () => {
    const { db, dbPath, runId } = setup();
    const a = createWorker({ workerId: 'wA', dbPath, pollMs: 10 });
    const b = createWorker({ workerId: 'wB', dbPath, pollMs: 10 });
    a.start();
    b.start();
    await waitFor(() => getRun(db, runId)?.status === 'completed', 15_000);
    await a.stop();
    await b.stop();

    const events = new SqliteStore(db).events(runId);
    for (const node of ['t', 'd1', 'd2', 'o']) {
      expect(events.filter((e) => e.type === 'NODE_STARTED' && e.nodeId === node)).toHaveLength(1);
    }
    expect(events.some((e) => e.type === 'RUN_RECOVERED')).toBe(false);
    expect(events.filter((e) => e.type === 'RUN_COMPLETED')).toHaveLength(1);
  });

  it('a worker that lost its lease is fenced out of the event log', () => {
    const { db, runId } = setup();
    const t0 = Date.now();
    expect(claimRun(db, runId, 'wA', t0 - 10_000, 1000)).toBe(true); // wA's lease is long expired
    expect(claimRun(db, runId, 'wB', t0, 6000)).toBe(true); // wB takes over

    const ev = { runId, nodeId: 't', attempt: 1, type: 'NODE_STARTED', data: { input: {} } } as const;
    expect(() => new SqliteStore(db, 'wA').append(ev)).toThrow(LeaseLostError);
    expect(new SqliteStore(db, 'wB').append(ev).seq).toBeGreaterThan(0);
  });

  it('a fenced effect commit rolls back the effect row too', () => {
    const { db, runId } = setup();
    claimRun(db, runId, 'wB', Date.now(), 6000);
    const zombie = new SqliteStore(db, 'wA');
    expect(() =>
      zombie.commitSuccess(
        { runId, nodeId: 'n', attempt: 1, type: 'NODE_SUCCEEDED', data: { output: {}, durationMs: 1 } },
        { channel: 'email', payload: { message: 'x' }, result: {} },
      ),
    ).toThrow(LeaseLostError);
    expect(db.prepare('SELECT COUNT(*) FROM outbox').pluck().get()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM effects').pluck().get()).toBe(0);
  });
});