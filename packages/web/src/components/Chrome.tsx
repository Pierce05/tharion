import { useEffect, useState } from 'react';
import { selectDirty, useWorkflow } from '../store/workflow';
import { useSystem } from '../store/system';
import { useUi } from '../store/ui';
import { goMode } from '../lib/actions';
import { navigate, useRoute, type Mode } from '../lib/route';
import { Icon, type IconName } from './Icons';

function WorkerPill() {
  const { sys, fetchedAt, error } = useSystem();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  if (error || !sys) {
    return <div className="pill lost" role="status"><span>{error ? 'api offline' : 'connecting…'}</span></div>;
  }
    if (sys.readOnly) {
        return <div className="pill" role="status" style={{ color: 'var(--amber)' }}><span>read-only demo · seeded runs</span></div>;
    }
  const alive = sys.supervisor ? sys.supervisor.alive : sys.workers.some((w) => w.alive);
  const wid = sys.supervisor?.workerId ?? sys.workers[0]?.id ?? 'worker';
  const elapsed = now - fetchedAt;
  const minLease = sys.leases.length ? Math.max(0, Math.min(...sys.leases.map((l) => l.remainingMs)) - elapsed) : null;
  const hb = sys.workers.find((w) => w.id === wid)?.lastHeartbeat;
  const fresh = alive && hb ? Math.max(0, 1 - (sys.now + elapsed - hb) / 6000) : minLease !== null ? minLease / 6000 : 0;

  const text = alive
    ? `${wid} alive · ${minLease !== null ? `lease ${(minLease / 1000).toFixed(1)}s` : 'idle'}`
    : minLease !== null && minLease > 0
      ? `${wid} lost · lease ${(minLease / 1000).toFixed(1)}s`
      : minLease !== null
        ? `${wid} lost · lease expired`
        : `${sys.supervisor ? wid : 'no worker'} lost`;

  return (
    <div className={`pill${alive ? '' : ' lost'}`} role="status" aria-label="Worker health">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="8" fill="none" stroke="#fff2" strokeWidth="2" />
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="50.3" strokeDashoffset={50.3 * (1 - Math.min(1, fresh))} transform="rotate(-90 10 10)" />
        <circle cx="10" cy="10" r="3" fill="currentColor" />
      </svg>
      <span>{text}</span>
    </div>
  );
}

function OutboxPill() {
  const count = useSystem((s) => s.sys?.counts.outbox ?? 0);
  const [bump, setBump] = useState(false);
  const [prev, setPrev] = useState(count);
  useEffect(() => {
    if (count !== prev) {
      setPrev(count);
      setBump(true);
      const t = setTimeout(() => setBump(false), 520);
      return () => clearTimeout(t);
    }
  }, [count, prev]);
  return (
    <div className={`pill${bump ? ' bump' : ''}`} id="obp" aria-label="Outbox rows">
      <Icon name="mail" /> outbox <b>{count}</b>
    </div>
  );
}

function VersionChip() {
  const version = useWorkflow((s) => s.version);
  const id = useWorkflow((s) => s.id);
  const load = useWorkflow((s) => s.load);
  const dirty = useWorkflow(selectDirty);
  const [open, setOpen] = useState(false);
  if (!id || version === null) return null;
  const versions = Array.from({ length: version }, (_, i) => version - i);
  return (
    <span className="dd" onMouseLeave={() => setOpen(false)}>
      <button className="chip" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}>
        v{version}{dirty && <span className="dirty" title="Unsaved changes" />}
      </button>
      {open && (
        <div className="glass menu" role="listbox">
          {versions.map((v) => (
            <button key={v} role="option" aria-selected={v === version} onClick={() => { setOpen(false); void load(id, v); }}>
              v{v}{v === version ? ' · loaded' : ''}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export function TopBar() {
  const name = useWorkflow((s) => s.name);
  const id = useWorkflow((s) => s.id);
  const rename = useWorkflow((s) => s.rename);
  const setCmdk = useUi((s) => s.setCmdk);
  return (
    <header className="top">
      <div className="brand">
        <svg className="logo" width="22" height="22" viewBox="0 0 90 90" fill="none" stroke="#FFB547" strokeWidth="7" aria-hidden="true">
          <path d="M45 8a37 37 0 1 1-26 10" /><path d="M45 45l16 9" /><path className="hand" d="M45 45V20" />
        </svg>
        THARION
      </div>
      {id && <input className="nameinp" aria-label="Workflow name" value={name} onChange={(e) => rename(e.target.value)} />}
      <VersionChip />
      <span className="sp" />
      <WorkerPill />
      <OutboxPill />
      <button onClick={() => setCmdk(true)} aria-label="Command palette">⌘K</button>
    </header>
  );
}

const MODES: { mode: Mode; label: string; icon: IconName; n: string; color?: string }[] = [
  { mode: 'build', label: 'BUILD', icon: 'grid', n: '1' },
  { mode: 'run', label: 'RUN', icon: 'play', n: '2' },
  { mode: 'rewind', label: 'REWIND', icon: 'rewind', n: '3', color: 'var(--cyan)' },
];

export function Rail() {
  const { mode } = useRoute();
  const openModal = useUi((s) => s.openModal);
  return (
    <nav className="rail" aria-label="Modes">
      {MODES.map((m) => (
        <button key={m.mode} className={mode === m.mode ? 'on' : ''} aria-label={`${m.label} mode`} aria-current={mode === m.mode} style={m.color ? { color: m.color } : undefined} onClick={() => goMode(m.mode)}>
          <Icon name={m.icon} /><small>{m.n}</small>{m.label}
        </button>
      ))}
      <span style={{ height: 10 }} />
      <button aria-label="Workflows" onClick={() => openModal('workflows')}><Icon name="list" /><small>wf</small></button>
      <button aria-label="Runs" onClick={() => navigate('run')}><Icon name="rows" /><small>runs</small></button>
      <button aria-label="Outbox" onClick={() => openModal('outbox')}><Icon name="inbox" /><small>out</small></button>
      <button className={mode === 'tests' ? 'on' : ''} aria-label="Engine tests" aria-current={mode === 'tests'} onClick={() => goMode('tests')}><Icon name="check" /><small>tests</small></button>
    </nav>
  );
}