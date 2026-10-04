import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, SqliteStore, type Db } from '@tharion/db';
import type { RunEvent } from '@tharion/engine';
import { createApp } from '@tharion/server';
import { Supervisor } from '@tharion/server/supervisor';

export async function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs = 20_000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export interface ApiResult {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

export interface Harness {
  db: Db;
  dbPath: string;
  baseUrl: string;
  supervisor: Supervisor;
  api(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResult>;
  events(runId: string): RunEvent[];
  close(): Promise<void>;
}

/** Real Express app + real SQLite file + (optionally) a real supervised worker OS process. */
export async function boot(opts: { worker?: boolean } = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'tharion-it-'));
  const dbPath = join(dir, 'it.db');
  const db = openDb(dbPath);
  const supervisor = new Supervisor({ db, dbPath, autoRestart: false, pollMs: 100, quiet: true });
  const app = createApp({ db, supervisor });
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  if (opts.worker) supervisor.start();
  const store = new SqliteStore(db);

  return {
    db,
    dbPath,
    baseUrl,
    supervisor,
    async api(method, path, body, headers) {
      const res = await fetch(baseUrl + path, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null };
    },
    events: (runId) => store.events(runId),
    async close() {
      await supervisor.stop();
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const lastType = (events: RunEvent[]): string | undefined => events[events.length - 1]?.type;