import { useState } from 'react';
import type { LineageNode } from '@tharion/engine';
import { SideBySide } from './SideBySide';
import type { DiffResponse } from '../lib/api';

interface Props {
  currentId: string;
  options: LineageNode[];
  compareId: string | null;
  onPick: (id: string) => void;
  data: DiffResponse | null;
  loading: boolean;
  error: string | null;
}

export function DiffPanel({ currentId, options, compareId, onPick, data, loading, error }: Props) {
  const [sel, setSel] = useState<string | null>(null);
  const d = data?.diff;
  const changed = d ? d.nodes.filter((n) => n.changed) : [];
  const focus = d ? (d.nodes.find((n) => n.nodeId === (sel ?? d.divergenceNodeId)) ?? changed[0]) : undefined;
  const label = (id: string): string => id.slice(-6);

  return (
    <div className="glass diff-table on" role="region" aria-label="Run diff">
      <div className="row">
        <h2>Run diff</h2>
        <span className="chip">{label(currentId)}</span>
        <span>vs</span>
        {options.length > 0 ? (
          <select className="inp" style={{ width: 200 }} aria-label="Compare with" value={compareId ?? ''} onChange={(e) => onPick(e.target.value)}>
            {options.map((o) => <option key={o.id} value={o.id}>{label(o.id)} · {o.status}{o.forkedAtNodeId ? ` · fork@${o.forkedAtNodeId}` : ''}</option>)}
          </select>
        ) : (
          <span className="mic">no other runs in this lineage. Fork this run to compare.</span>
        )}
      </div>
      {loading && <div className="skel" />}
      {error && <p className="m" style={{ color: 'var(--bad)' }}>{error}</p>}
      {d && (
        <>
          <p className="mic" style={{ margin: '10px 0 14px', color: d.divergenceNodeId ? 'var(--fork)' : 'var(--ok)' }}>
            {d.divergenceNodeId ? `DIVERGED HERE · ${d.nodes.find((n) => n.nodeId === d.divergenceNodeId)?.label ?? d.divergenceNodeId}` : 'NO DIVERGENCE · the runs match node for node'}
          </p>
          <table>
            <thead><tr><th>node</th><th>status</th><th>input</th><th>output</th></tr></thead>
            <tbody>
              {changed.map((n) => (
                <tr key={n.nodeId} style={{ cursor: 'pointer', background: focus?.nodeId === n.nodeId ? 'var(--ink2)' : undefined }} onClick={() => setSel(n.nodeId)}>
                  <td>{n.label}</td>
                  <td className={n.statusChanged ? 'ch' : ''}>{n.a.status} → {n.b.status}</td>
                  <td className={n.inputChanged ? 'ch' : ''}>{n.inputChanged ? 'changed' : 'same'}</td>
                  <td className={n.outputChanged ? 'ch' : ''}>{n.outputChanged ? 'changed' : 'same'}</td>
                </tr>
              ))}
              <tr>
                <td>final result</td>
                <td className={d.statusA !== d.statusB ? 'ch' : ''}>{d.statusA} → {d.statusB}</td>
                <td>—</td>
                <td className={d.resultChanged ? 'ch' : ''}>{d.resultChanged ? 'changed' : 'same'}</td>
              </tr>
            </tbody>
          </table>
          {focus && (
            <>
              <SideBySide title={`${focus.label} · input`} left={focus.a.input} right={focus.b.input} leftLabel={`${label(currentId)}`} rightLabel={label(compareId ?? '')} />
              <SideBySide title={`${focus.label} · output`} left={focus.a.output ?? focus.a.error} right={focus.b.output ?? focus.b.error} leftLabel={`${label(currentId)}`} rightLabel={label(compareId ?? '')} />
            </>
          )}
          {d.resultChanged && <SideBySide title="final result" left={d.resultA} right={d.resultB} leftLabel={label(currentId)} rightLabel={label(compareId ?? '')} />}
        </>
      )}
    </div>
  );
}