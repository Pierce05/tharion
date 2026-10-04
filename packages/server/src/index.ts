import { defaultDbPath, markAllWorkersDead, openDb } from '@tharion/db';
import { createApp } from './app';
import { Supervisor } from './supervisor';

const port = Number(process.env.PORT ?? 3001);
const dbPath = defaultDbPath();
const db = openDb(dbPath);
markAllWorkersDead(db);

const supervisor = new Supervisor({
  db,
  dbPath,
  autoRestart: process.env.AUTO_RESTART === '1',
  pollMs: Number(process.env.POLL_MS ?? 500),
});
if (process.env.NO_WORKER !== '1') supervisor.start();

const server = createApp({ db, supervisor }).listen(port, () => {
  console.log(`[server] http://localhost:${port}  db=${dbPath}`);
});

process.on('unhandledRejection', (e) => console.error('[server] unhandledRejection', e));
const shutdown = (): void => {
  void supervisor.stop().finally(() => {
    server.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);