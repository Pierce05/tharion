import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { reduce, type Lineage, type RunState } from '@tharion/engine';
import { BranchSplit } from '../components/BranchSplit';
import { DiffPanel } from '../components/DiffPanel';
import { ErrorState, Loading } from '../components/EmptyState';
import { FlowCanvas } from '../components/FlowCanvas';
import { Icon } from '../components/Icons';
import { LineageTree } from '../components/LineageTree';
import { Scrubber, scrubberHeight } from '../components/Scrubber';
import { TimeInspector } from '../components/TimeInspector';
import { api, type DiffResponse } from '../lib/api';
import { errMsg } from '../lib/format';
import { eventPositions } from '../lib/rewind';
import { useRoute } from '../lib/route';
import { edgePayloadsFrom, edgeViewsFrom, nodeViewsFrom } from '../lib/runView';
import { useRunDetail, useRunStream } from '../lib/useRun';
import { useFx } from '../store/fx';
import { useSystem } from '../store/system';
import { useUi } from '../store/ui';
import { RunList } from './RunView';

interface DiffState {
  data: DiffResponse | null;
  loading: boolean;
  error: string | null;
}

function RewindCanvas({ runId }: { runId: string }) {
  const readOnly = useSystem((s) => s.sys?.readOnly === true);
  const setLastRun = useUi((s) => s.setLastRun);
  const { events, ended, connected } = useRunStream(runId);
  const { detail, error } = useRunDetail(runId, ended);

  const [cursor, setCursor] = useState(0);
  const [follow, setFollow] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<'timeline' | 'diff'>('timeline');
  const [selected, setSelected] = useState<string | null>(null);
  const [glitch, setGlitch] = useState(0);
  const [lineage, setLineage] = useState<Lineage | null>(null);
  const [parentState, setParentState] = useState<RunState | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffState>({ data: null, loading: false, error: null });
  const [fx, setFx] = useState(() => Date.now() - useFx.getState().forkAt < 4000);

  const workflow = detail?.workflow ?? null;
  const eff = follow ? events.length : Math.min(cursor, events.length);
  const effRef = useRef(eff);
  effRef.current = eff;
  const lenRef = useRef(events.length);
  lenRef.current = events.length;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const seek = useCallback((c: number) => {
    const n = lenRef.current;
    const next = Math.max(0, Math.min(n, c));
    if (next < effRef.current) setGlitch((g) => g + 1);
    setCursor(next);
    setFollow(next >= n);
  }, []);

  const togglePlay = useCallback(() => {
    if (playingRef.current) {
      setPlaying(false);
      return;
    }
    if (effRef.current >= lenRef.current) seek(0);
    setPlaying(true);
  }, [seek]);

  useEffect(() => setLastRun(runId), [runId, setLastRun]);

  useEffect(() => {
    let alive = true;
    api
      .lineage(runId)
      .then((l) => {
        if (alive) setLineage(l);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [runId, ended]);

  const parentId = detail?.run.parentRunId ?? null;
  useEffect(() => {
    if (!parentId || !workflow) {
      setParentState(null);
      return;
    }
    let alive = true;
    api
      .runEvents(parentId)
      .then((r) => {
        if (alive) setParentState(reduce(workflow, r.events));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [parentId, workflow]);

  useEffect(() => {
    if (view !== 'diff' || compareId || !lineage) return;
    const me = lineage.nodes.find((n) => n.id === runId);
    const pick = me?.parentRunId ?? lineage.nodes.find((n) => n.parentRunId === runId)?.id ?? null;
    if (pick) setCompareId(pick);
  }, [view, compareId, lineage, runId]);

  useEffect(() => {
    if (view !== 'diff' || !compareId) return;
    let alive = true;
    setDiff({ data: null, loading: true, error: null });
    api
      .diff(runId, compareId)
      .then((data) => {
        if (alive) setDiff({ data, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (alive) setDiff({ data: null, loading: false, error: errMsg(e) });
      });
    return () => {
      alive = false;
    };
  }, [view, compareId, runId]);

  useEffect(() => {
    if (!playing) return;
    if (eff >= events.length) {
      setPlaying(false);
      return;
    }
    const next = events[eff];
    const prev = events[eff - 1];
    const dt = next && prev ? Math.min(400, Math.max(40, next.ts - prev.ts)) : 120;
    const t = setTimeout(() => {
      setCursor(eff + 1);
      setFollow(eff + 1 >= events.length);
    }, dt);
    return () => clearTimeout(t);
  }, [playing, eff, events]);

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return;
      const ui = useUi.getState();
      if (ui.cmdk || ui.modal || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPlaying(false);
        seek(effRef.current + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPlaying(false);
        seek(effRef.current - 1);
      } else if (e.code === 'Space' && !/BUTTON/.test(t.tagName)) {
        e.preventDefault();
        togglePlay();
      } else if (e.key.toLowerCase() === 'f') {
        document.getElementById('fork-input')?.focus();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [seek, togglePlay]);

  const state = useMemo(() => (workflow ? reduce(workflow, events, eff) : null), [workflow, events, eff]);
  const finalState = useMemo(() => (workflow ? reduce(workflow, events) : null), [workflow, events]);
  const positions = useMemo(() => eventPositions(events), [events]);
  const playheadNode = eff > 0 ? (events[eff - 1]?.nodeId ?? null) : null;
  const divergedId = view === 'diff' ? (diff.data?.diff.divergenceNodeId ?? null) : null;

  const nodeViews = useMemo(
    () => (workflow && state ? nodeViewsFrom(workflow, state, { playheadNodeId: playheadNode, divergedNodeId: divergedId }) : undefined),
    [workflow, state, playheadNode, divergedId],
  );
  const edgeViews = useMemo(() => (workflow && state ? edgeViewsFrom(workflow, state, true) : undefined), [workflow, state]);
  const edgePayloads = useMemo(() => (state ? edgePayloadsFrom(state) : undefined), [state]);

  const jumpSeq = useCallback(
    (seq: number) => {
      const i = events.findIndex((e) => e.seq === seq);
      if (i < 0) return;
      setPlaying(false);
      seek(i + 1);
      const nid = events[i]?.nodeId;
      if (nid) setSelected(nid);
    },
    [events, seek],
  );

  if (error) return <div className="cv"><ErrorState message={error} /></div>;
  if (!detail || !workflow || !state || !finalState) return <div className="cv"><Loading text="Loading run…" /></div>;

  const sel = selected ?? playheadNode;
  const t0 = events[0]?.ts ?? 0;
  const cur = eff > 0 ? events[eff - 1] : undefined;
  const dockH = scrubberHeight(workflow.nodes.length) + 56;
  const failed = finalState.status === 'failed';
  const statusColor = state.status === 'failed' ? 'var(--bad)' : state.status === 'completed' ? 'var(--ok)' : 'var(--cyan)';

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
          selectedNodeId={sel}
          onSelectNode={setSelected}
        />
        {glitch > 0 && <div key={glitch} className="glitchfx" aria-hidden="true" />}

        <div className="glass runhdr wrap">
          <span className="sg" style={{ fontWeight: 600 }}>REWIND · {runId.slice(-8)}</span>
          <span className="chip" style={{ color: statusColor }}>{events.length === 0 ? 'LOADING' : state.status.toUpperCase()}</span>
          {!ended && <span className="chip">{connected ? 'live' : 'reconnecting…'}</span>}
          <span className="row" role="group" aria-label="View">
            <button className={`tab${view === 'timeline' ? ' on' : ''}`} onClick={() => setView('timeline')}>Timeline</button>
            <button className={`tab${view === 'diff' ? ' on' : ''}`} onClick={() => setView('diff')}>Diff</button>
          </span>
          <button onClick={() => window.location.assign(`#/run/${encodeURIComponent(runId)}`)}>Run view</button>
        </div>

        <LineageTree lineage={lineage} currentId={runId} />
        {view === 'diff' && (
          <DiffPanel
            currentId={runId}
            options={(lineage?.nodes ?? []).filter((n) => n.id !== runId)}
            compareId={compareId}
            onPick={setCompareId}
            data={diff.data}
            loading={diff.loading}
            error={diff.error}
          />
        )}
        {fx && <BranchSplit onDone={() => setFx(false)} />}
        <div className="hint">REWIND · drag the timeline · ←/→ step · Space play · F fork</div>
      </div>

      <section className="glass dock" aria-label="Timeline">
        <div className="readout">
          <button aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>{playing ? '❚❚' : <Icon name="play" />}</button>
          <span aria-live="off">EVENT {eff}/{events.length} · T+{cur ? ((cur.ts - t0) / 1000).toFixed(3) : '0.000'}s</span>
        </div>
        <span className="mic">TIMELINE · click or drag to scrub</span>
        <Scrubber nodes={workflow.nodes} events={events} positions={positions} cursor={eff} selectedNodeId={sel} onSeek={(c) => { setPlaying(false); seek(c); }} />
      </section>

      <aside className="side open rw" style={{ bottom: dockH + 26 }} aria-label="Time inspector">
        <TimeInspector
          run={detail.run}
          workflow={workflow}
          events={events}
          cursor={eff}
          state={state}
          finalState={finalState}
          parentState={parentState}
          nodeId={sel}
          failed={failed}
          readOnly={readOnly}
          onJumpSeq={jumpSeq}
        />
      </aside>
    </>
  );
}

export function RewindView() {
  const { id } = useRoute();
  return id ? <RewindCanvas key={id} runId={id} /> : <RunList to="rewind" />;
}