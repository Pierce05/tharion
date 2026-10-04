import { planFork, reduce, type Json, type RunRecord } from '@tharion/engine';
import type { Db } from './connection';
import { createRun, getRun, getWorkflow } from './repo';
import { SqliteStore } from './store';

export class ForkError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'ForkError';
  }
}

export interface ForkArgs {
  parentRunId: string;
  atNodeId: string;
  inputOverride?: Json;
  dryRun?: boolean;
}

/** FR-T3: creates a forked run (parentRunId + forkedAtNodeId) with upstream replayed. The worker executes the rest. */
export function forkRun(db: Db, a: ForkArgs): { run: RunRecord; replayed: string[] } {
  const parent = getRun(db, a.parentRunId);
  if (!parent) throw new ForkError(404, 'run not found');
  const wf = getWorkflow(db, parent.workflowId, parent.workflowVersion);
  if (!wf) throw new ForkError(404, `workflow ${parent.workflowId}@${parent.workflowVersion} not found`);

  const parentEvents = new SqliteStore(db).events(parent.id);
  const target = reduce(wf, parentEvents).nodes[a.atNodeId];
  if (!target) throw new ForkError(400, `node "${a.atNodeId}" is not in this workflow`);
  if (target.status === 'skipped') {
    throw new ForkError(409, `node "${a.atNodeId}" was skipped in the parent run, so there is nothing to fork from`);
  }
  const plan = planFork(wf, { parentRunId: parent.id, runId: 'pending', parentEvents, atNodeId: a.atNodeId });
  if (!plan.ok) throw new ForkError(plan.code === 'NO_NODE' ? 400 : 409, plan.error);

  const { run } = createRun(db, {
    workflowId: parent.workflowId,
    workflowVersion: parent.workflowVersion,
    triggerPayload: parent.triggerPayload,
    dryRun: a.dryRun ?? parent.dryRun,
    faults: null,
    parentRunId: parent.id,
    forkedAtNodeId: a.atNodeId,
    inputOverride: a.inputOverride,
    replay: (id) => plan.events.map((e) => ({ ...e, runId: id })),
  });
  return { run, replayed: plan.upstream };
}