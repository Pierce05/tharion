import { useMemo, useState } from 'react';
import type { Json, RunEvent, RunRecord, RunState, Workflow } from '@tharion/engine';
import { ForkCard } from './ForkCard';
import { InvestigateCard } from './InvestigateCard';
import { JsonView } from './JsonView';
import { SideBySide } from './SideBySide';
import { TYPE_META } from '../lib/nodeMeta';
import { attemptRecords, type AttemptRecord } from '../lib/rewind';

interface Props {
  run: RunRecord;
  workflow: Workflow;
  events: RunEvent[];
  cursor: number;
  state: RunState;
  finalState: RunState;
  parentState: RunState | null;
  nodeId: string | null;
  failed: boolean;
  readOnly: boolean;
  onJumpSeq: (seq: number) => void;
}

type Cmp = 'auto' | 'prev' | 'parent' | 'none';
const symbol = (r: AttemptRecord): string => (r.outcome === 'succeeded' ? '✓' : r.outcome === 'failed' ? '✕' : r.outcome === 'replayed' ? '⑂' : '…');
const outcomeOf = (r: AttemptRecord): Json | undefined => (r.output !== undefined ? r.output : r.error !== undefined ? { error: r.error } : undefined);

export function TimeInspector(p: Props) {
  const [cmp, setCmp] = useState<Cmp>('auto');
  const node = p.nodeId ? p.workflow.nodes.find((n) => n.id === p.nodeId) : undefined;
  const ns = p.nodeId ? p.state.nodes[p.nodeId] : undefined;
  const fin = p.nodeId ? p.finalState.nodes[p.nodeId] : undefined;
  const parentNode = p.nodeId && p.parentState ? p.parentState.nodes[p.nodeId] : undefined;
  const records = useMemo(() => (p.nodeId ? attemptRecords(p.events, p.nodeId, p.cursor) : []), [p.events, p.nodeId, p.cursor]);

  const hasPrev = records.length >= 2;
  const mode: Cmp = cmp === 'auto' ? (parentNode ? 'parent' : hasPrev ? 'prev' : 'none') : cmp;

  let compare: { l: { input?: Json; output?: Json }; r: { input?: Json; output?: Json }; ll: string; rl: string } | null = null;
  if (mode === 'prev' && hasPrev) {
    const a = records[records.length - 2] as AttemptRecord;
    const b = records[records.length - 1] as AttemptRecord;
    compare = { l: { input: a.input, output: outcomeOf(a) }, r: { input: b.input, output: outcomeOf(b) }, ll: `attempt ${a.attempt}`, rl: `attempt ${b.attempt}` };
  } else if (mode === 'parent' && parentNode && ns) {
    compare = { l: { input: parentNode.input, output: parentNode.output }, r: { input: ns.input, output: ns.output }, ll: 'parent run', rl: 'this run' };
  }

  return (
    <>
      <span className="mic">TIME INSPECTOR</span>
      {p.run.parentRunId && (
        <div className="m" style={{ fontSize: 11, color: 'var(--fork)', marginTop: 4 }}>
          ⑂ forked from {p.run.parentRunId.slice(-6)} at {p.workflow.nodes.find((n) => n.id === p.run.forkedAtNodeId)?.label ?? p.run.forkedAtNodeId}
        </div>
      )}

      {p.failed && <InvestigateCard runId={p.run.id} nodes={p.workflow.nodes} onJumpSeq={p.onJumpSeq} forkDisabled={p.readOnly} />}

      {node && ns ? (
        <>
          <div className="row" style={{ marginTop: 10 }}>
            <h2>{node.label}</h2>
            <span className="chip" style={{ color: TYPE_META[node.type].color }}>{node.type}</span>
            <span className="chip">{ns.replayed ? 'replayed' : ns.status}</span>
          </div>
          <div className="m" style={{ color: 'var(--cyan)', fontSize: 11, marginTop: 4 }}>
            {records.length > 0 ? records.map((r) => `attempt ${r.attempt} ${symbol(r)}`).join(' → ') : 'not executed yet at this point'}
            {ns.durationMs !== undefined ? ` · ${ns.durationMs}ms` : ''}
          </div>
          {ns.error && <pre className="err">{ns.error}</pre>}
          <div className="pv">
            <div><span className="mic">input</span>{ns.input !== undefined ? <JsonView value={ns.input} /> : <pre>—</pre>}</div>
            <div><span className="mic">output</span>{ns.output !== undefined ? <JsonView value={ns.output} /> : <pre>—</pre>}</div>
          </div>

          {(hasPrev || parentNode) && (
            <div style={{ marginTop: 10 }}>
              <label className="fld">
                <span className="mic">compare with</span>
                <select className="inp" value={cmp} onChange={(e) => setCmp(e.target.value as Cmp)}>
                  <option value="auto">auto</option>
                  {hasPrev && <option value="prev">previous attempt</option>}
                  {parentNode && <option value="parent">parent run</option>}
                  <option value="none">none</option>
                </select>
              </label>
              {compare && (
                <>
                  <SideBySide title="input" left={compare.l.input} right={compare.r.input} leftLabel={compare.ll} rightLabel={compare.rl} />
                  <SideBySide title="output" left={compare.l.output} right={compare.r.output} leftLabel={compare.ll} rightLabel={compare.rl} />
                </>
              )}
            </div>
          )}

          <ForkCard runId={p.run.id} nodeId={node.id} nodeLabel={node.label} defaultInput={fin?.input} disabled={p.readOnly} />
        </>
      ) : (
        <p className="mic" style={{ marginTop: 24 }}>Click a node, or scrub the timeline</p>
      )}
    </>
  );
}