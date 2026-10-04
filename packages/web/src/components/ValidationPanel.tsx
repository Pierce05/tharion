import { useState } from 'react';
import { Icon } from './Icons';
import { useWorkflow } from '../store/workflow';

const CHECKS: { label: string; codes: string[]; warn?: boolean }[] = [
  { label: 'trigger present', codes: ['NO_TRIGGER', 'TRIGGER_INBOUND'] },
  { label: 'acyclic', codes: ['CYCLE'] },
  { label: 'all reachable', codes: ['UNREACHABLE'] },
  { label: 'types compatible', codes: ['EDGE_TYPE', 'EDGE_BAD_HANDLE', 'EDGE_DANGLING', 'DUPLICATE_NODE_ID'] },
  { label: 'condition returns boolean', codes: ['COND_NOT_BOOLEAN', 'COND_EVAL'] },
  { label: 'JSONata parses', codes: ['JSONATA_PARSE', 'COND_PARSE'] },
  { label: 'has an output', codes: ['NO_OUTPUT'], warn: true },
  { label: 'no orphan outputs', codes: ['ORPHAN_OUTPUT'], warn: true },
];

export function ValidationPanel() {
  const [open, setOpen] = useState(false);
  const issues = useWorkflow((s) => s.issues);
  const edges = useWorkflow((s) => s.edges);
  const select = useWorkflow((s) => s.select);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  const headline =
    errors.length > 0
      ? `${errors.length} error${errors.length > 1 ? 's' : ''}${warnings.length ? ` · ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : ''}`
      : warnings.length > 0
        ? `Valid · ${warnings.length} warning${warnings.length > 1 ? 's' : ''}`
        : 'All clear. Ready when you are.';

  const focus = (nodeId?: string, edgeId?: string): void => {
    const id = nodeId ?? edges.find((e) => e.id === edgeId)?.source;
    if (id) select(id);
  };

  return (
    <section className={`glass valid${open ? ' open' : ''}`} aria-label="Validation">
      <div className="vh" role="button" tabIndex={0} onClick={() => setOpen(!open)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen(!open)}>
        <b style={{ color: errors.length ? 'var(--bad)' : 'var(--ok)' }}>{headline}</b>
        <span className="sp" />
        <span>{open ? '▴' : '▾'}</span>
      </div>
      <div className="vl">
        {CHECKS.map((c) => {
          const hit = issues.filter((i) => c.codes.includes(i.code));
          const bad = hit.length > 0;
          return (
            <div key={c.label} style={{ color: bad ? (c.warn ? 'var(--amber)' : 'var(--bad)') : 'var(--t1)' }}>
              {bad ? (c.warn ? '△' : '✕') : <Icon name="check" className="sm" />} {c.label}
            </div>
          );
        })}
        {issues.length > 0 && <div className="mic" style={{ marginTop: 10 }}>Issues</div>}
        {issues.map((i, k) => (
          <div key={k} className="iss" onClick={() => focus(i.nodeId, i.edgeId)} style={{ color: i.severity === 'error' ? 'var(--bad)' : 'var(--amber)' }}>
            {i.severity === 'error' ? '✕' : '△'} {i.message}{i.fixHint ? ` — ${i.fixHint}` : ''}
          </div>
        ))}
      </div>
    </section>
  );
}