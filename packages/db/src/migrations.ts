import type Database from 'better-sqlite3';

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'init',
    sql: `
CREATE TABLE workflows (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  definition TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (id, version)
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  trigger_payload TEXT NOT NULL DEFAULT 'null',
  parent_run_id TEXT,
  forked_at_node_id TEXT,
  dry_run INTEGER NOT NULL DEFAULT 0,
  faults TEXT,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX runs_status ON runs(status);
CREATE INDEX runs_parent ON runs(parent_run_id);

CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  node_id TEXT,
  attempt INTEGER,
  data TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX events_run ON events(run_id, seq);

CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;

CREATE TABLE effects (
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (run_id, node_id)
);

CREATE TABLE outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (run_id, node_id)
);

CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  pid INTEGER NOT NULL,
  last_heartbeat INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE hooks (
  token TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE webhook_deliveries (
  token TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (token, idempotency_key)
);
`,
  },
];

/** Applies pending migrations. Returns ids applied. Safe under concurrent callers. */
export function migrate(db: Database.Database): number[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)',
  );
  const ran: number[] = [];
  for (const m of MIGRATIONS) {
    const apply = db.transaction(() => {
      const done = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(m.id);
      if (done) return;
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, Date.now());
      ran.push(m.id);
    });
    apply.immediate();
  }
  return ran;
}