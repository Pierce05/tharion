import express, { type NextFunction, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z, ZodError } from 'zod';
import {
  SqliteStore,
  countOutbox,
  createRun,
  getHook,
  getOrCreateHook,
  getRun,
  getWorkflow,
  listOutbox,
  listRuns,
  listWorkers,
  listWorkflows,
  saveWorkflow,
  type Db,
} from '@tharion/db';
import {
  LEASE_TTL_MS,
  hasErrors,
  reduce,
  validateWorkflow,
  type JsonObject,
  type RunFaults,
  type Workflow,
  type WorkflowDefinition,
} from '@tharion/engine';
import { definitionSchema, faultsSchema, jsonObjectSchema, workflowIdSchema } from './schemas';
import type { Supervisor } from './supervisor';

export interface AppDeps {
  db: Db;
  supervisor: Supervisor | null;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type Handler = (req: Request, res: Response) => Promise<void> | void;
const wrap =
  (fn: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch(next);
  };

const TERMINAL_EVENTS = new Set(['RUN_COMPLETED', 'RUN_FAILED', 'RUN_CANCELLED']);

export function createApp({ db, supervisor }: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  const store = new SqliteStore(db);

  async function launch(
    wf: Workflow,
    args: { payload: JsonObject; dryRun: boolean; faults: RunFaults | null; idempotency?: { token: string; key: string } },
  ) {
    const issues = await validateWorkflow(wf);
    if (hasErrors(issues)) throw new HttpError(422, 'workflow has validation errors', { issues });
    return createRun(db, {
      workflowId: wf.id,
      workflowVersion: wf.version,
      triggerPayload: args.payload,
      dryRun: args.dryRun,
      faults: args.faults,
      idempotency: args.idempotency,
    });
  }

  const needWorkflow = (id: string, version?: number): Workflow => {
    const wf = getWorkflow(db, id, version);
    if (!wf) throw new HttpError(404, `workflow ${id} not found`);
    return wf;
  };

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, now: Date.now() });
  });

  // ---------- workflows ----------
  app.get('/api/workflows', (_req, res) => {
    res.json({ workflows: listWorkflows(db) });
  });

  app.post(
    '/api/workflows',
    wrap((req, res) => {
      const body = z
        .object({ id: workflowIdSchema.optional(), name: z.string().min(1).max(120), definition: definitionSchema })
        .parse(req.body);
      const id = body.id ?? `wf_${randomBytes(4).toString('hex')}`;
      res.status(201).json(saveWorkflow(db, { id, name: body.name, definition: body.definition as WorkflowDefinition }));
    }),
  );

  app.get(
    '/api/workflows/:id',
    wrap((req, res) => {
      const q = z.object({ version: z.coerce.number().int().positive().optional() }).parse(req.query);
      res.json(needWorkflow(req.params.id as string, q.version));
    }),
  );

  app.put(
    '/api/workflows/:id',
    wrap((req, res) => {
      const id = req.params.id as string;
      const current = needWorkflow(id);
      const body = z.object({ name: z.string().min(1).max(120).optional(), definition: definitionSchema }).parse(req.body);
      res.json(saveWorkflow(db, { id, name: body.name ?? current.name, definition: body.definition as WorkflowDefinition }));
    }),
  );

  app.post(
    '/api/workflows/:id/validate',
    wrap(async (req, res) => {
      const body = z.object({ definition: definitionSchema.optional() }).parse(req.body ?? {});
      const def: WorkflowDefinition = body.definition
        ? (body.definition as WorkflowDefinition)
        : needWorkflow(req.params.id as string);
      const issues = await validateWorkflow(def);
      res.json({ issues, valid: !hasErrors(issues) });
    }),
  );

  app.post(
    '/api/workflows/:id/hook',
    wrap((req, res) => {
      const wf = needWorkflow(req.params.id as string);
      res.json({ token: getOrCreateHook(db, wf.id), path: '/api/hooks/' });
    }),
  );

  app.post(
    '/api/workflows/:id/runs',
    wrap(async (req, res) => {
      const body = z
        .object({
          payload: jsonObjectSchema.default({}),
          dryRun: z.boolean().default(false),
          faults: faultsSchema.optional(),
          version: z.number().int().positive().optional(),
        })
        .parse(req.body ?? {});
      const wf = needWorkflow(req.params.id as string, body.version);
      const { run } = await launch(wf, { payload: body.payload, dryRun: body.dryRun, faults: body.faults ?? null });
      res.status(201).json({ run });
    }),
  );

  // ---------- webhooks (FR-TR2) ----------
  app.post(
    '/api/hooks/:token',
    wrap(async (req, res) => {
      const token = req.params.token as string;
      const hook = getHook(db, token);
      if (!hook) throw new HttpError(404, 'unknown webhook token');
      const payload = jsonObjectSchema.parse(req.body ?? {});
      const key = req.header('Idempotency-Key')?.trim();
      const wf = needWorkflow(hook.workflowId);
      const { run, deduped } = await launch(wf, {
        payload,
        dryRun: false,
        faults: null,
        idempotency: key ? { token, key } : undefined,
      });
      res.status(deduped ? 200 : 202).json({ runId: run.id, deduped });
    }),
  );

  // ---------- runs ----------
  app.get(
    '/api/runs',
    wrap((req, res) => {
      const q = z
        .object({ workflowId: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })
        .parse(req.query);
      res.json({ runs: listRuns(db, q) });
    }),
  );

  app.get(
    '/api/runs/:id',
    wrap((req, res) => {
      const run = getRun(db, req.params.id as string);
      if (!run) throw new HttpError(404, 'run not found');
      const workflow = getWorkflow(db, run.workflowId, run.workflowVersion);
      const events = store.events(run.id);
      res.json({
        run,
        workflow,
        state: workflow ? reduce(workflow, events) : null,
        eventCount: events.length,
      });
    }),
  );

  app.get(
    '/api/runs/:id/events',
    wrap((req, res) => {
      const id = req.params.id as string;
      if (!getRun(db, id)) throw new HttpError(404, 'run not found');
      const from = z.coerce.number().int().min(0).default(0).parse(req.query.from ?? 0);
      res.json({ events: store.eventsAfter(id, from - 1) });
    }),
  );

  // SSE (FR-L1): polls SQLite because the worker is a separate process.
  app.get(
    '/api/runs/:id/stream',
    wrap((req, res) => {
      const id = req.params.id as string;
      if (!getRun(db, id)) throw new HttpError(404, 'run not found');
      const lastId = req.header('last-event-id');
      const fromQ = z.coerce.number().int().min(0).default(0).parse(req.query.from ?? 0);
      let last = lastId && /^\d+$/.test(lastId) ? Number(lastId) : fromQ - 1;

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');

      let closed = false;
      const poll = (): void => {
        if (closed) return;
        try {
          for (const ev of store.eventsAfter(id, last)) {
            last = ev.seq;
            res.write(`id: ${ev.seq}\nevent: run-event\ndata: ${JSON.stringify(ev)}\n\n`);
            if (TERMINAL_EVENTS.has(ev.type)) {
              res.write('event: end\ndata: {}\n\n');
              cleanup();
              res.end();
              return;
            }
          }
        } catch (e) {
          console.error('[sse] poll failed', e);
          cleanup();
          res.end();
        }
      };
      const pollTimer = setInterval(poll, 200);
      const pingTimer = setInterval(() => res.write(': ping\n\n'), 15_000);
      function cleanup(): void {
        closed = true;
        clearInterval(pollTimer);
        clearInterval(pingTimer);
      }
      req.on('close', cleanup);
      poll();
    }),
  );

  app.get('/api/outbox', (_req, res) => {
    res.json({ rows: listOutbox(db), count: countOutbox(db) });
  });

  // ---------- system & chaos ----------
  app.get('/api/system', (_req, res) => {
    const t = Date.now();
    const leases = (
      db
        .prepare(
          "SELECT id, lease_owner, lease_expires_at FROM runs WHERE lease_owner IS NOT NULL AND status IN ('queued', 'running')",
        )
        .all() as { id: string; lease_owner: string; lease_expires_at: number }[]
    ).map((l) => ({
      runId: l.id,
      owner: l.lease_owner,
      expiresAt: l.lease_expires_at,
      remainingMs: l.lease_expires_at - t,
    }));
    const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM runs GROUP BY status').all() as {
      status: string;
      n: number;
    }[];
    res.json({
      now: t,
      supervisor: supervisor?.status() ?? null,
      workers: listWorkers(db, 5).map((w) => ({
        ...w,
        alive: w.status === 'alive' && t - w.lastHeartbeat < LEASE_TTL_MS,
      })),
      leases,
      counts: {
        runsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
        outbox: countOutbox(db),
        events: db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number,
      },
    });
  });

  const needSupervisor = (): Supervisor => {
    if (!supervisor) throw new HttpError(503, 'no supervised worker in this deployment');
    return supervisor;
  };

  app.post(
    '/api/chaos/kill-worker',
    wrap((_req, res) => {
      try {
        res.json({ killed: needSupervisor().kill() });
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(409, e instanceof Error ? e.message : 'kill failed');
      }
    }),
  );

  app.post(
    '/api/chaos/start-worker',
    wrap((_req, res) => {
      try {
        res.status(201).json({ started: needSupervisor().start() });
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(409, e instanceof Error ? e.message : 'start failed');
      }
    }),
  );

  app.post(
    '/api/chaos/auto-restart',
    wrap((req, res) => {
      const body = z.object({ enabled: z.boolean() }).parse(req.body);
      needSupervisor().autoRestart = body.enabled;
      res.json({ autoRestart: body.enabled });
    }),
  );

  // ---------- errors ----------
  app.use((_req, res) => {
    res.status(404).json({ error: 'not found' });
  });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'invalid request', details: err.issues });
      return;
    }
    if (typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
      res.status((err as { status: number }).status).json({ error: 'bad request body' });
      return;
    }
    console.error('[server] unhandled error', err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}