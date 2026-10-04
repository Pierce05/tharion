import { existsSync, rmSync } from 'node:fs';
import { defaultDbPath, openDb } from './connection';

const cmd = process.argv[2];
const path = defaultDbPath();

if (cmd === 'reset') {
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(path + suffix)) rmSync(path + suffix);
  }
  console.log('db reset:', path);
} else if (cmd !== 'migrate') {
  console.error('usage: cli.ts migrate|reset');
  process.exit(1);
}

const db = openDb(path);
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .pluck()
  .all();
console.log('db:', path);
console.log('tables:', tables.join(', '));
db.close();