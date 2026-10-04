import type { Express } from 'express';
import { z } from 'zod';
import { ForkError, forkRun, getLineage, getRun, getWorkflow, listRuns, type Db, type SqliteStore } from '@tharion/db';
import { diffRuns, reduce, type Json, type RunEvent } from '@tharion/engine';
import { evidenceRunning, readEvidence, startTestRun } from '../evidence';
import { HttpError, wrap } from '../http';
import { jsonSchema } from '../schemas';

export interface ExtraDeps {
  db: Db;
  store: SqliteStore;
  readOnly: boolean;
}

function resultOf(events: readonly RunEvent[]): Json | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e && e.type === 'RUN_COMPLETED') return e.data.result;
  }
  return undefined;
}

export function registerExtraRoutes(app: Express, d: ExtraDeps): void {
  const { db, store } = d;

  const loadRun = (id: string) => {
    const run = getRun(db, id);
    if (!run) throw new HttpError(404, 'run not found');
    const wf = getWorkflow(db, run.workflowId, run.workflowVersion);
    if (!wf) throw new HttpError(404, 'workflow not found');
    return { run, wf };
  };

  // FR-T3
  app.post(
    '/api/runs/:id/fork',
    wrap((req, res) => {
      const body = z
        .object({ atNodeId: z.string().min(1), inputOverride: jsonSchema.optional(), dryRun: z.boolean().optional() })
        .parse(req.body ?? {});
      try {
        res.status(201).json(forkRun(db, { parentRunId: req.params.id as string, ...body }));
      } catch (e) {
        if (e instanceof ForkError) throw new HttpError(e.status, e.message);
        throw e;
      }
    }),
  );

  // FR-T4
  app.get(
    '/api/diff',
    wrap((req, res) => {
      const q = z.object({ a: z.string().min(1), b: z.string().min(1) }).parse(req.query);
      const A = loadRun(q.a);
      const B = loadRun(q.b);
      if (A.run.workflowId !== B.run.workflowId || A.run.workflowVersion !== B.run.workflowVersion) {
        throw new HttpError(400, 'runs must belong to the same workflow version');
      }
      res.json({ a: A.run, b: B.run, diff: diffRuns(A.wf, store.events(A.run.id), store.events(B.run.id)) });
    }),
  );

  // FR-T5
  app.get(
    '/api/runs/:id/lineage',
    wrap((req, res) => {
      const l = getLineage(db, req.params.id as string);
      if (!l) throw new HttpError(404, 'run not found');
      res.json(l);
    }),
  );


  

  // test evidence (Phase 7)
  app.get('/api/tests', (_req, res) => {
    res.json({ running: evidenceRunning(), report: readEvidence() });
  });
  app.post(
    '/api/tests/run',
    wrap((_req, res) => {
      if (!startTestRun()) throw new HttpError(409, 'tests are already running');
      res.status(202).json({ started: true });
    }),
  );
}