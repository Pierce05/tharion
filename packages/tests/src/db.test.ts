import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS, migrate, openDb, type Db } from '@tharion/db';
import { LEASE_TTL_MS } from '@tharion/engine';

const open: Db[] = [];
const dirs: string[] = [];

function mem(): Db {
  const db = openDb(':memory:');
  open.push(db);
  return db;
}

afterEach(() => {
  while (open.length) open.pop()?.close();
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function insertRun(db: Db, id: string): void {
  db.prepare(
    `INSERT INTO runs (id, workflow_id, workflow_version, status, created_at, updated_at)
     VALUES (?, 'wf', 1, 'queued', 0, 0)`,
  ).run(id);
}

const CLAIM_SQL = `UPDATE runs SET lease_owner = ?, lease_expires_at = ?
  WHERE id = ? AND (lease_owner IS NULL OR lease_expires_at < ?)`;

describe('schema', () => {
  it('migrations are idempotent', () => {
    const db = mem();
    expect(migrate(db)).toEqual([]);
    const count = db.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get();
    expect(count).toBe(MIGRATIONS.length);
  });

  it('events table rejects UPDATE and DELETE (test 13)', () => {
    const db = mem();
    db.prepare(
      `INSERT INTO events (run_id, type, node_id, attempt, data, ts) VALUES ('r1', 'RUN_STARTED', NULL, NULL, '{}', 1)`,
    ).run();
    expect(() => db.prepare(`UPDATE events SET type = 'X' WHERE run_id = 'r1'`).run()).toThrow(/append-only/);
    expect(() => db.prepare(`DELETE FROM events WHERE run_id = 'r1'`).run()).toThrow(/append-only/);
    expect(db.prepare('SELECT COUNT(*) FROM events').pluck().get()).toBe(1);
  });

  it('effects and outbox are unique per (run_id, node_id)', () => {
    const db = mem();
    const eff = db.prepare(`INSERT OR IGNORE INTO effects (run_id, node_id, result, created_at) VALUES ('r', 'n', '{}', 0)`);
    expect(eff.run().changes).toBe(1);
    expect(eff.run().changes).toBe(0);

    const out = db.prepare(
      `INSERT INTO outbox (run_id, node_id, channel, payload, created_at) VALUES ('r', 'n', 'email', '{}', 0)`,
    );
    out.run();
    expect(() => out.run()).toThrow(/UNIQUE/);
    expect(db.prepare('SELECT COUNT(*) FROM outbox').pluck().get()).toBe(1);
  });

  it('webhook deliveries dedupe on (token, idempotency_key)', () => {
    const db = mem();
    const ins = db.prepare(
      `INSERT INTO webhook_deliveries (token, idempotency_key, run_id, created_at) VALUES ('t', 'k', 'r', 0)`,
    );
    ins.run();
    expect(() => ins.run()).toThrow(/UNIQUE|PRIMARY/);
  });
});

describe('lease claim (FR-D1)', () => {
  it('only one claimant wins; an expired lease can be re-claimed', () => {
    const db = mem();
    insertRun(db, 'r1');
    const claim = db.prepare(CLAIM_SQL);

    expect(claim.run('w1', 1000 + LEASE_TTL_MS, 'r1', 1000).changes).toBe(1);
    expect(claim.run('w2', 2000 + LEASE_TTL_MS, 'r1', 2000).changes).toBe(0);
    expect(claim.run('w2', 8000 + LEASE_TTL_MS, 'r1', 1000 + LEASE_TTL_MS + 1).changes).toBe(1);
    expect(db.prepare('SELECT lease_owner FROM runs WHERE id = ?').pluck().get('r1')).toBe('w2');
  });

  it('is atomic across two connections to the same WAL file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tharion-'));
    dirs.push(dir);
    const file = join(dir, 'test.db');
    const a = openDb(file);
    const b = openDb(file);
    open.push(a, b);

    expect(a.pragma('journal_mode', { simple: true })).toBe('wal');
    insertRun(a, 'r1');

    const ra = a.prepare(CLAIM_SQL).run('wa', 10_000, 'r1', 1000).changes;
    const rb = b.prepare(CLAIM_SQL).run('wb', 10_000, 'r1', 1000).changes;
    expect(ra + rb).toBe(1);
  });
});