import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markWorkerStatus, type Db } from '@tharion/db';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../../..');
const WORKER_MAIN = resolve(here, '../../worker/src/main.ts');

export interface SupervisorOptions {
  db: Db;
  dbPath: string;
  autoRestart?: boolean;
  pollMs?: number;
  quiet?: boolean;
}

export interface SupervisorStatus {
  workerId: string | null;
  pid: number | null;
  alive: boolean;
  autoRestart: boolean;
  startedAt: number | null;
}

/** Spawns and supervises the worker as a separate OS process. Auto-restart is OFF by default. */
export class Supervisor {
  autoRestart: boolean;
  private child: ChildProcess | null = null;
  private current: { id: string; pid: number; startedAt: number } | null = null;
  private seq = 0;
  private closing = false;

  constructor(private readonly opts: SupervisorOptions) {
    this.autoRestart = opts.autoRestart ?? false;
  }

  get alive(): boolean {
    return this.child !== null && this.child.exitCode === null && this.child.signalCode === null;
  }

  start(): { id: string; pid: number } {
    if (this.alive) throw new Error('worker already running');
    const id = `w${++this.seq}`;
    const child = spawn(process.execPath, ['--import', 'tsx', WORKER_MAIN], {
      cwd: ROOT,
      env: {
        ...process.env,
        WORKER_ID: id,
        THARION_DB: this.opts.dbPath,
        POLL_MS: String(this.opts.pollMs ?? 500),
      },
      stdio: ['ignore', this.opts.quiet ? 'ignore' : 'inherit', 'inherit'],
    });
    const pid = child.pid ?? -1;
    this.child = child;
    this.current = { id, pid, startedAt: Date.now() };

    child.on('error', (e) => console.error(`[supervisor] worker ${id} error:`, e));
    child.on('exit', (code, signal) => {
      markWorkerStatus(this.opts.db, id, 'dead');
      if (this.child === child) this.child = null;
      if (!this.opts.quiet) console.log(`[supervisor] worker ${id} exited code=${code} signal=${signal}`);
      if (this.autoRestart && !this.closing) {
        setTimeout(() => {
          if (!this.closing && !this.alive) this.start();
        }, 1000);
      }
    });
    return { id, pid };
  }

  /** SIGKILL, no cleanup: this is the chaos action. */
  kill(): { id: string; pid: number } {
    if (!this.alive || !this.child || !this.current) throw new Error('no worker is running');
    this.child.kill('SIGKILL');
    return { id: this.current.id, pid: this.current.pid };
  }

  status(): SupervisorStatus {
    return {
      workerId: this.current?.id ?? null,
      pid: this.current?.pid ?? null,
      alive: this.alive,
      autoRestart: this.autoRestart,
      startedAt: this.current?.startedAt ?? null,
    };
  }

  async stop(): Promise<void> {
    this.closing = true;
    const child = this.child;
    if (child && this.alive) {
      await new Promise<void>((resolveExit) => {
        child.once('exit', () => resolveExit());
        child.kill('SIGKILL');
      });
    }
  }
}