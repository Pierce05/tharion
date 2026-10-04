import { useEffect, useMemo, useState } from 'react';
import { reduce, type RunRecord, type RunState } from '@tharion/engine';
import { ChaosPanel, KillFlash } from '../components/ChaosPanel';
import { ErrorState, Loading } from '../components/EmptyState';
import { FlowCanvas } from '../components/FlowCanvas';
import { LogPanel } from '../components/LogPanel';
import { RecoveryBanner } from '../components/RecoveryBanner';
import { RunHeader } from '../components/RunHeader';
import { api } from '../lib/api';
import { errMsg } from '../lib/format';
import { launchRun } from '../lib/runActions';
import { navigate, useRoute } from '../lib/route';
import { edgePayloadsFrom, edgeViewsFrom, nodeViewsFrom } from '../lib/runView';
import { useRunDetail, useRunStream } from '../lib/useRun';
import { useRunConfig } from '../store/runConfig';
import { useSystem } from '../store/system';
import { useUi } from '../store/ui';

const statusColor = (s: string): string => (s === 'failed' ? 'var(--bad)' : s === 'completed' ? 'var(--ok)' : 'var(--amber)');

export function RunList({ to = 'run' }: { to?: 'run' | 'rewind' }) {
  const [runs, setRuns] = useState<RunRecord[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.listRuns(50).then((r) => setRuns(r.runs)).catch((e: unknown) => setErr(errMsg(e)));
  }, []);
  return (
    <div className="cv">
      <div className="state">
        <div className="glass" style={{ width: 600, textAlign: 'left' }}>
          <h2>Runs</h2>
          {err && <p className="m" style={{ color: 'var(--bad)' }}>{err}</p>}
          {!runs && !err && <div className="skel" />}
          {runs?.length === 0 && (
            <>
              <p>No runs yet. Build a workflow and press Run.</p>
              <button onClick={() => navigate('build')}>Go to Build</button>
            </>
          )}
          {runs?.map((r) => (
              <button key={r.id} className="lrow" onClick={() => navigate(to, r.id)}>
              <b className="m">{r.id}</b>
              <span className="chip" style={{ color: statusColor(r.status) }}>{r.status}</span>
              {r.dryRun && <span className="chip" style={{ color: 'var(--cyan)' }}>dry</span>}
              {r.parentRunId && <span className="chip" style={{ color: 'var(--fork)' }}>fork</span>}
              <span className="sp" />
              <span className="mic">{r.workflowId} · {new Date(r.createdAt).toLocaleTimeString()}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function chipFor(state: RunState, eventCount: number, workerAlive: boolean): { label: string; color: string } {
  if (eventCount === 0) return { label: 'CONNECTING', color: 'var(--t1)' };
  if (state.status === 'completed') return { label: 'COMPLETED', color: 'var(--ok)' };
  if (state.status === 'failed') return { label: 'FAILED', color: 'var(--bad)' };
  if (state.status === 'cancelled') return { label: 'CANCELLED', color: 'var(--t1)' };
  return workerAlive ? { label: 'RUNNING', color: 'var(--amber)' } : { label: 'STALLED', color: 'var(--bad)' };
}

function RunCanvas({ runId }: { runId: string }) {
  const setLastRun = useUi((s) => s.setLastRun);
  const sys = useSystem((s) => s.sys);
  const { events, ended, connected } = useRunStream(runId);
  const { detail, error } = useRunDetail(runId, ended);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => setLastRun(runId), [runId, setLastRun]);

  const detailRunId = detail?.run.id;
  useEffect(() => {
    if (detail) useRunConfig.getState().seed(JSON.stringify(detail.run.triggerPayload, null, 2));
    // seed once per loaded run, not on every refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailRunId]);

  const workflow = detail?.workflow ?? null;
  const workflowId = workflow?.id;
  const state = useMemo(() => (workflow ? reduce(workflow, events) : null), [workflow, events]);
  const workerAlive = sys ? (sys.supervisor ? sys.supervisor.alive : sys.workers.some((w) => w.alive)) : true;
  const terminal = state ? state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled' : false;

  const nodeViews = useMemo(() => (workflow && state ? nodeViewsFrom(workflow, state, { stalled: !workerAlive && !terminal }) : undefined), [workflow, state, workerAlive, terminal]);
  const edgeViews = useMemo(() => (workflow && state ? edgeViewsFrom(workflow, state, workerAlive) : undefined), [workflow, state, workerAlive]);
  const edgePayloads = useMemo(() => (state ? edgePayloadsFrom(state) : undefined), [state]);

  useEffect(() => {
    if (!workflowId) return;
    const h = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.repeat) return;
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(t.tagName) || t.isContentEditable) return;
      const ui = useUi.getState();
      if (ui.cmdk || ui.modal) return;
      e.preventDefault();
      void launchRun(workflowId);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [workflowId]);

  if (error) return <div className="cv"><ErrorState message={error} onRetry={() => navigate('run')} /></div>;
  if (!detail || !workflow || !state) return <div className="cv"><Loading text="Loading run…" /></div>;

  return (
    <>
      <div className="cv" style={{ marginRight: 354 }}>
        <div className="bloom" />
        <FlowCanvas
          canvasKey={runId}
          nodes={workflow.nodes}
          edges={workflow.edges}
          nodeViews={nodeViews}
          edgeViews={edgeViews}
          edgePayloads={edgePayloads}
          selectedNodeId={selected}
          onSelectNode={setSelected}
        />
        <RunHeader workflow={workflow} run={detail.run} chip={chipFor(state, events.length, workerAlive)} live={connected || ended} />
        <RecoveryBanner runId={runId} events={events} terminal={terminal} />
        <ChaosPanel runId={runId} />
      </div>
      <LogPanel runId={runId} workflow={workflow} events={events} state={state} selectedNodeId={selected} onSelectNode={setSelected} />
      <KillFlash />
    </>
  );
}

export function RunView() {
  const { id } = useRoute();
  return id ? <RunCanvas key={id} runId={id} /> : <RunList />;
}