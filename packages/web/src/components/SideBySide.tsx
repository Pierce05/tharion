import { Fragment, useMemo } from 'react';
import { lineDiff } from '@tharion/engine';

const pretty = (v: unknown): string => (v === undefined ? '—' : (JSON.stringify(v, null, 2) ?? '—'));

export function SideBySide({
  title,
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  title: string;
  left: unknown;
  right: unknown;
  leftLabel: string;
  rightLabel: string;
}) {
  const rows = useMemo(() => lineDiff(pretty(left), pretty(right)), [left, right]);
  const changed = rows.some((r) => r.kind !== 'same');
  return (
    <div className="sbs">
      <div className="row">
        <span className="mic">{title}</span>
        <span className="chip" style={{ color: changed ? 'var(--fork)' : 'var(--ok)' }}>{changed ? 'changed' : 'identical'}</span>
      </div>
      <div className="sbs-grid">
        <div className="mic">{leftLabel}</div>
        <div className="mic">{rightLabel}</div>
        {rows.map((r, i) => (
          <Fragment key={i}>
            <div className={`ln${r.kind === 'del' ? ' del' : ''}`}>{r.left ?? ' '}</div>
            <div className={`ln${r.kind === 'add' ? ' add' : ''}`}>{r.right ?? ' '}</div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}