import { useEffect, useMemo, useState } from 'react';
import type { Json } from '@tharion/engine';
import { Icon } from './Icons';
import { forkAt } from '../lib/rewindActions';

interface Props {
  runId: string;
  nodeId: string;
  nodeLabel: string;
  defaultInput: Json | undefined;
  disabled: boolean;
}

export function ForkCard({ runId, nodeId, nodeLabel, defaultInput, disabled }: Props) {
  const initial = useMemo(() => (defaultInput === undefined ? '' : JSON.stringify(defaultInput, null, 2)), [defaultInput]);
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(initial), [initial, nodeId]);

  let parsed: { ok: true; value: Json } | { ok: false; error: string };
  try {
    parsed = text.trim() === '' ? { ok: false, error: 'this node never received input in this run' } : { ok: true, value: JSON.parse(text) as Json };
  } catch (e) {
    parsed = { ok: false, error: e instanceof Error ? e.message : 'invalid JSON' };
  }
  const changed = parsed.ok && JSON.stringify(parsed.value) !== JSON.stringify(defaultInput);

  return (
    <div className="glass fork-card">
      <span className="mic" style={{ color: 'var(--fork)' }}>FORK FROM HERE · {nodeLabel}</span>
      <textarea id="fork-input" className="inp" rows={8} aria-label="Fork input JSON" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="m" style={{ fontSize: 11, color: parsed.ok ? 'var(--ok)' : 'var(--bad)' }}>
        {parsed.ok ? (changed ? '● valid JSON · input edited' : '● valid JSON · original input') : `✕ ${parsed.error}`}
      </div>
      <p className="mic" style={{ letterSpacing: 0, textTransform: 'none', margin: '8px 0' }}>
        Upstream nodes are replayed (not re-executed). This node and everything downstream run again.
      </p>
      <button
        className="fk"
        disabled={!parsed.ok || busy || disabled}
        title={disabled ? 'Forking is disabled in the read-only deployment' : undefined}
        onClick={() => {
          if (!parsed.ok) return;
          setBusy(true);
          void forkAt(runId, nodeId, changed ? parsed.value : undefined).finally(() => setBusy(false));
        }}
      >
        Fork <Icon name="fork" />
      </button>
    </div>
  );
}