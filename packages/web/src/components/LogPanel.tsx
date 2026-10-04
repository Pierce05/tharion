import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deliveryProof,
  eventDetail,
  filterEvents,
  type LogFilter,
  type OutboxRow,
  type RunEvent,
  type RunState,
  type WorkflowDefinition,
} from '@tharion/engine';
import { JsonView } from './JsonView';
import { api } from '../lib/api';
import { EVENT_COLORS, TYPE_META } from '../lib/nodeMeta';
import { useSystem } from '../store/system';
import { useUi } from '../store/ui';

type Tab = 'log' | 'node' | 'payloads';

interface Props {
  runId: string;
  workflow: WorkflowDefinition;
  events: RunEvent[];
  state: RunState;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}

function useRunOutbox(runId: string, eventCount: number): OutboxRow[] {
  const total = useSystem((s) => s.sys?.counts.outbox ?? 0);
  const [rows, setRows] = useState<OutboxRow[]>([]);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api
        .outbox()
        .then((r) => {
          if (alive) setRows(r.rows.filter((x) => x.runId === runId));
        })
        .catch(() => undefined);
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [runId, eventCount, total]);
  return rows;
}

const ATTEMPT_TYPES = new Set(['NODE_FAILED_ATTEMPT', 'NODE_SUCCEEDED', 'NODE_REPLAYED', 'NODE_FAILED']);

export function LogPanel({ runId, workflow, events, state, selectedNodeId, onSelectNode }: Props) {
  const [tab, setTab] = useState<Tab>('log');
  const [nodeFilter, setNodeFilter] = useState('');
  const [level, setLevel] = useState<NonNullable<LogFilter['level']>>('all');
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const body = useRef<HTMLDivElement>(null);
  const showToast = useUi((s) => s.showToast);
  const outbox = useRunOutbox(runId, events.length);

  const filtered = useMemo(() => filterEvents(events, { nodeId: nodeFilter || null, level, query }), [events, nodeFilter, level, query]);
  const proofs = useMemo(() => deliveryProof(events, outbox, runId), [events, outbox, runId]);
  const t0 = events[0]?.ts ?? 0;
  const labelOf = (id: string): string => workflow.nodes.find((n) => n.id === id)?.label ?? id;

  useEffect(() => {
    if (tab === 'log' && follow && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [filtered.length, follow, tab]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(filtered, null, 2));
      showToast(`Copied ${filtered.length} events as JSON`);
    } catch {
      showToast('Clipboard unavailable');
    }
  };

  const node = selectedNodeId ? workflow.nodes.find((n) => n.id === selectedNodeId) : undefined;
  const ns = selectedNodeId ? state.nodes[selectedNodeId] : undefined;
  const history = selectedNodeId ? events.filter((e) => e.nodeId === selectedNodeId && ATTEMPT_TYPES.has(e.type)) : [];
  const taken = workflow.edges.filter((e) => state.edges[e.id]?.taken);

  return (
    <aside className="side open tall col" aria-label="Run panel">
      <div className="row">
        {(['log', 'node', 'payloads'] as Tab[]).map((t) => (
          <button key={t} className={`tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
        <span className="sp" />
        <span className="mic">{events.length} events</span>
      </div>

      {tab === 'log' && (
        <div className="logbar">
          <select className="inp" aria-label="Filter by node" value={nodeFilter} onChange={(e) => setNodeFilter(e.target.value)}>
            <option value="">all nodes</option>
            {workflow.nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
          <select className="inp" aria-label="Minimum level" value={level} onChange={(e) => setLevel(e.target.value as NonNullable<LogFilter['level']>)}>
            <option value="all">all levels</option>
            <option value="warn">warn +</option>
            <option value="error">errors</option>
          </select>
          <input className="inp" style={{ flexBasis: '100%' }} placeholder="Search events…" aria-label="Search events" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button aria-pressed={follow} onClick={() => setFollow(!follow)} style={follow ? { borderColor: 'var(--amber)' } : undefined}>follow tail</button>
          <button onClick={() => void copy()}>Copy JSON</button>
        </div>
      )}

      <div
        className="sbody"
        ref={body}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (tab === 'log' && follow && el.scrollHeight - el.scrollTop - el.clientHeight > 40) setFollow(false);
        }}
      >
        {tab === 'log' && (
          <>
            {filtered.map((e) => {
              const detail = eventDetail(e);
              return (
                <div key={e.seq} className="logrow clk" style={{ color: EVENT_COLORS[e.type] ?? 'var(--t1)' }} onClick={() => e.nodeId && onSelectNode(e.nodeId)}>
                  +{((e.ts - t0) / 1000).toFixed(3)}s {e.type} {e.nodeId ?? ''}
                  {e.attempt && e.attempt > 1 ? ` attempt ${e.attempt}` : ''}
                  {detail ? ` · ${detail}` : ''}
                </div>
              );
            })}
            {events.length === 0 && <div className="mic" style={{ marginTop: 30 }}>Waiting for the first event…</div>}
            {events.length > 0 && filtered.length === 0 && <div className="mic" style={{ marginTop: 30 }}>No events match the filter</div>}
          </>
        )}

        {tab === 'node' &&
          (node && ns ? (
            <>
              <div className="row" style={{ marginTop: 10 }}>
                <h2>{node.label}</h2>
                <span className="chip" style={{ color: TYPE_META[node.type].color }}>{node.type}</span>
                <span className="chip">{ns.replayed ? 'replayed' : ns.status}</span>
              </div>
              <div className="m" style={{ fontSize: 11, color: 'var(--t1)', marginTop: 4 }}>
                attempt {ns.attempt}{ns.durationMs !== undefined ? ` · ${ns.durationMs}ms` : ''}
              </div>
              {history.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <span className="mic">attempt history</span>
                  {history.map((e) => (
                    <div key={e.seq} className="logrow" style={{ color: EVENT_COLORS[e.type] }}>
                      attempt {e.attempt} {e.type === 'NODE_SUCCEEDED' ? '✓' : e.type === 'NODE_REPLAYED' ? '⑂' : '✕'} {eventDetail(e)}
                    </div>
                  ))}
                </div>
              )}
              {ns.error && <pre className="err">{ns.error}</pre>}
              <div className="pv">
                <div><span className="mic">input</span>{ns.input !== undefined ? <JsonView value={ns.input} /> : <pre>—</pre>}</div>
                <div><span className="mic">output</span>{ns.output !== undefined ? <JsonView value={ns.output} /> : <pre>—</pre>}</div>
              </div>
            </>
          ) : (
            <div className="mic" style={{ marginTop: 30 }}>Select a node on the canvas</div>
          ))}

        {tab === 'payloads' &&
          (taken.length > 0 ? (
            taken.map((e) => (
              <div key={e.id}>
                <div className="mic" style={{ marginTop: 10 }}>{labelOf(e.source)} → {labelOf(e.target)}</div>
                <JsonView value={state.edges[e.id]?.payload ?? null} />
              </div>
            ))
          ) : (
            <div className="mic" style={{ marginTop: 30 }}>No payloads yet</div>
          ))}
      </div>

      {tab === 'log' && proofs.length > 0 && (
        <div className="glass proof" aria-label="Outbox proof">
          <span className="mic" style={{ color: 'var(--ok)' }}>exactly-once effects</span>
          {proofs.map((p) => (
            <div key={p.nodeId} className="m" style={{ fontSize: 11, marginTop: 6 }}>
              <b>{labelOf(p.nodeId)}</b> · {p.attempts} attempt{p.attempts === 1 ? '' : 's'} started · <span style={{ color: p.rows === 1 ? 'var(--ok)' : 'var(--bad)' }}>{p.rows} outbox row{p.rows === 1 ? '' : 's'}</span>
              <div style={{ color: 'var(--t2)' }}>key {p.key} · stable across attempts</div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}