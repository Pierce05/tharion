import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { setAutoRestart, killWorker, startWorker } from '../lib/runActions';
import { useNow } from '../lib/useNow';
import { useSystem } from '../store/system';
import { useUi } from '../store/ui';

const HOLD_MS = 600;

export function KillFlash() {
  const n = useUi((s) => s.flash);
  return n === 0 ? null : <div key={n} className="flash on" aria-hidden="true" />;
}

export function ChaosPanel({ runId }: { runId: string }) {
  const sys = useSystem((s) => s.sys);
  const fetchedAt = useSystem((s) => s.fetchedAt);
  const now = useNow(100);
  const [pct, setPct] = useState(0);
  const hold = useRef<{ raf: number } | null>(null);

  const sup = sys?.supervisor ?? null;
  const alive = sup ? sup.alive : false;
  const aliveRef = useRef(alive);
  aliveRef.current = alive;

  const begin = useCallback(() => {
    if (hold.current || !aliveRef.current) return;
    const t0 = performance.now();
    const state = { raf: 0 };
    hold.current = state;
    const step = (): void => {
      const p = Math.min(1, (performance.now() - t0) / HOLD_MS);
      setPct(p);
      if (p >= 1) {
        hold.current = null;
        setPct(0);
        void killWorker();
        return;
      }
      state.raf = requestAnimationFrame(step);
    };
    state.raf = requestAnimationFrame(step);
  }, []);

  const cancel = useCallback(() => {
    const h = hold.current;
    if (!h) return;
    cancelAnimationFrame(h.raf);
    hold.current = null;
    setPct(0);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== 'k' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return;
      const ui = useUi.getState();
      if (ui.cmdk || ui.modal) return;
      begin();
    };
    const up = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() === 'k') cancel();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      cancel();
    };
  }, [begin, cancel]);

  const lease = sys?.leases.find((l) => l.runId === runId);
  const remaining = lease ? Math.max(0, lease.remainingMs - (now - fetchedAt)) : null;

  return (
    <div className="glass chaos-panel" role="group" aria-label="Chaos controls">
      <span className="mic" style={{ color: 'var(--bad)' }}>CHAOS</span>
      <div className="m" style={{ fontSize: 11, marginTop: 8, color: 'var(--t1)' }}>
        {sup ? `worker ${sup.workerId ?? '—'} · ${alive ? 'alive' : 'dead'}${sup.pid && alive ? ` · pid ${sup.pid}` : ''}` : 'no supervised worker in this deployment'}
      </div>
      {lease && remaining !== null && (
        <div className="m" style={{ fontSize: 11, color: alive ? 'var(--t1)' : 'var(--bad)' }}>
          lease {lease.owner} · {(remaining / 1000).toFixed(1)}s
        </div>
      )}

      {sup && !alive ? (
        <button className="startw" onClick={() => void startWorker()}>START WORKER</button>
      ) : (
        <button
          className="kill"
          style={{ '--p': `${pct * 100}%` } as CSSProperties}
          disabled={!sup}
          aria-label="Hold to kill worker"
          onMouseDown={begin}
          onMouseUp={cancel}
          onMouseLeave={cancel}
          onTouchStart={begin}
          onTouchEnd={cancel}
        >
          HOLD · KILL WORKER (K)
        </button>
      )}

      {sup && (
        <label className="m" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, marginTop: 10, color: 'var(--t1)' }}>
          <input type="checkbox" checked={sup.autoRestart} onChange={(e) => void setAutoRestart(e.target.checked)} />
          auto-restart (off for the demo)
        </label>
      )}
      <div className="mic" style={{ marginTop: 8, letterSpacing: 0, textTransform: 'none' }}>
        Kill while a node is running to watch the lease expire and the run recover.
      </div>
    </div>
  );
}