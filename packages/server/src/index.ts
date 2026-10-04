import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultDbPath, markAllWorkersDead, openDb } from '@tharion/db';
import { llmFromEnv } from './ai';
import { createApp } from './app';
import { Supervisor } from './supervisor';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const port = Number(process.env.PORT ?? 3001);
const readOnly = process.env.READ_ONLY === '1';
const dbPath = defaultDbPath();
const db = openDb(dbPath);
markAllWorkersDead(db);

const supervisor = readOnly
  ? null
  : new Supervisor({
      db,
      dbPath,
      autoRestart: process.env.AUTO_RESTART === '1',
      pollMs: Number(process.env.POLL_MS ?? 500),
    });
if (supervisor && process.env.NO_WORKER !== '1') supervisor.start();

const webDist = resolve(ROOT, 'packages/web/dist');
const staticDir = (readOnly || process.env.SERVE_WEB === '1') && existsSync(webDist) ? webDist : undefined;
const llm = llmFromEnv();

const server = createApp({ db, supervisor, readOnly, llm, staticDir }).listen(port, () => {
  console.log(`[server] http://localhost:${port}  db=${dbPath}  readOnly=${readOnly}  ai=${llm ? llm.model : 'cached samples only'}`);
});

process.on('unhandledRejection', (e) => console.error('[server] unhandledRejection', e));
const shutdown = (): void => {
  void (supervisor ? supervisor.stop() : Promise.resolve()).finally(() => {
    server.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);