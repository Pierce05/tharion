import { useEffect, useState } from 'react';
import type { RunRecord, Workflow } from '@tharion/engine';
import { Icon } from './Icons';
import { navigate } from '../lib/route';
import { fireDuplicateWebhook, launchRun, parsePayload } from '../lib/runActions';
import { useRunConfig } from '../store/runConfig';

type FaultKind = 'fail' | 'slow' | 'crash';
const KIND_LABEL: Record<FaultKind, string> = { fail: 'Fail node ×N', slow: 'Slow node', crash: 'Crash after effect' };

interface Props {
  workflow: Workflow;
  run: RunRecord;
  chip: { label: string; color: string };
  live: boolean;
}

export function RunHeader({ workflow, run, chip, live }: Props) {
  const cfg = useRunConfig();
  const [open, setOpen] = useState<'faults' | 'payload' | null>(null);
  const [kind, setKind] = useState<FaultKind>('fail');
  const [nodeId, setNodeId] = useState('');
  const [val, setVal] = useState(2);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('.dd')) setOpen(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const options = workflow.nodes.filter((n) => (kind === 'crash' ? n.type === 'notify' : n.type !== 'trigger' && n.type !== 'output'));
  const selNode = options.some((o) => o.id === nodeId) ? nodeId : (options[0]?.id ?? '');
  const pv = parsePayload(cfg.payloadText);

  const arm = (): void => {
    if (!selNode) return;
    if (kind === 'fail') cfg.addFail(selNode, Math.max(1, val));
    else if (kind === 'slow') cfg.addSlow(selNode, Math.max(0, val));
    else cfg.setCrash(selNode);
    setOpen(null);
  };

  const armed = [
    ...cfg.failNodes.map((f) => ({ key: `f:${f.nodeId}`, text: `fail ${f.nodeId} ×${f.times}`, remove: () => cfg.removeFail(f.nodeId) })),
    ...cfg.slowNodes.map((f) => ({ key: `s:${f.nodeId}`, text: `slow ${f.nodeId} ${f.ms}ms`, remove: () => cfg.removeSlow(f.nodeId) })),
    ...(cfg.crashAfterEffect ? [{ key: 'c', text: `crash after ${cfg.crashAfterEffect}`, remove: () => cfg.setCrash(null) }] : []),
  ];

  return (
    <div className="glass runhdr wrap">
      <span className="sg" style={{ fontWeight: 600 }}>Run {run.id}</span>
      <span className="chip" style={{ color: chip.color }}>{chip.label}</span>
      {run.dryRun && <span className="chip" style={{ color: 'var(--cyan)' }}>DRY RUN</span>}
      <span className="chip">{live ? 'live' : 'reconnecting…'}</span>

      <button
        id="bRun"
        className="glow"
        disabled={busy}
        title="Start a new run (Space)"
        onClick={() => {
          setBusy(true);
          void launchRun(workflow.id).finally(() => setBusy(false));
        }}
      >
        <Icon name="play" /> Run
      </button>
      <button aria-pressed={cfg.dryRun} onClick={() => cfg.setDryRun(!cfg.dryRun)}>Dry run: {cfg.dryRun ? 'on' : 'off'}</button>

      <span className="dd">
        <button aria-expanded={open === 'faults'} onClick={() => setOpen(open === 'faults' ? null : 'faults')}>
          <Icon name="bolt" /> Faults ▾
        </button>
        {open === 'faults' && (
          <div className="glass pop" role="dialog" aria-label="Fault injection">
            <span className="mic">Inject a fault into the next run</span>
            <label className="fld">
              <span className="mic">fault</span>
              <select
                className="inp"
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as FaultKind;
                  setKind(k);
                  setVal(k === 'fail' ? 2 : 6000);
                  setNodeId('');
                }}
              >
                {(Object.keys(KIND_LABEL) as FaultKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="fld">
              <span className="mic">node</span>
              <select className="inp" value={selNode} onChange={(e) => setNodeId(e.target.value)}>
                {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            {kind !== 'crash' && (
              <label className="fld">
                <span className="mic">{kind === 'fail' ? 'times (attempts that fail)' : 'delay ms'}</span>
                <input className="inp" type="number" min={kind === 'fail' ? 1 : 0} max={kind === 'fail' ? 10 : 60000} value={val} onChange={(e) => setVal(Number(e.target.value) || 0)} />
              </label>
            )}
            <p className="mic" style={{ letterSpacing: 0, textTransform: 'none', marginTop: 10 }}>
              Armed faults apply to the next run only.{kind === 'fail' ? ' A count at or above the node’s max attempts fails the run.' : ''}
              {kind === 'crash' ? ' The worker SIGKILLs itself after the effect is written and before the event commits.' : ''}
            </p>
            <div className="row" style={{ marginTop: 10 }}>
              <button disabled={!selNode} onClick={arm}>Arm fault</button>
              <button onClick={() => { setOpen(null); void fireDuplicateWebhook(workflow.id); }}>Fire duplicate webhook ×2</button>
            </div>
          </div>
        )}
      </span>

      <span className="dd">
        <button aria-expanded={open === 'payload'} onClick={() => setOpen(open === 'payload' ? null : 'payload')}>{'{ }'} Trigger</button>
        {open === 'payload' && (
          <div className="glass pop" style={{ width: 360 }} role="dialog" aria-label="Trigger payload">
            <span className="mic">Trigger payload</span>
            <textarea className="inp" rows={9} style={{ marginTop: 8 }} value={cfg.payloadText} onChange={(e) => cfg.setPayloadText(e.target.value)} aria-label="Trigger payload JSON" />
            <div className="row" style={{ marginTop: 6 }}>
              <span className="m" style={{ fontSize: 11, color: pv.ok ? 'var(--ok)' : 'var(--bad)' }}>{pv.ok ? '● valid JSON object' : `✕ ${pv.error}`}</span>
              <span className="sp" />
              <button onClick={() => cfg.seed(JSON.stringify(run.triggerPayload, null, 2))}>Reset to this run</button>
            </div>
          </div>
        )}
      </span>

      {armed.map((a) => (
        <button key={a.key} className="chip" style={{ color: 'var(--amber)' }} onClick={a.remove} title="Click to disarm">{a.text} ×</button>
      ))}

      <button onClick={() => navigate('build', workflow.id)}>Build</button>
        <button onClick={() => navigate('rewind', run.id)}>Rewind</button>
      <button onClick={() => navigate('run')}>Runs</button>
    </div>
  );
}