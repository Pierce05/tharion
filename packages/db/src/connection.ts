import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrations';

export type Db = Database.Database;

export function defaultDbPath(): string {
  if (process.env.THARION_DB) return resolve(process.env.THARION_DB);
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../data/tharion.db');
}

/** Opens (and migrates) the database. Safe to call from several processes at once. */
export function openDb(path: string = defaultDbPath()): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}