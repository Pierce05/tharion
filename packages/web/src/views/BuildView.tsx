import { useEffect, useState } from 'react';
import { hasErrors, type DescribeResult, type NodeType } from '@tharion/engine';
import { FlowCanvas, DRAG_MIME } from '../components/FlowCanvas';
import { ErrorState, Loading, NoWorkflows } from '../components/EmptyState';
import { Icon } from '../components/Icons';
import { Inspector } from '../components/Inspector';
import { ValidationPanel } from '../components/ValidationPanel';
import { saveWorkflow, startRun } from '../lib/actions';
import { describeFromPrompt } from '../lib/aiActions';
import { NODE_TYPES, TYPE_META } from '../lib/nodeMeta';
import { useRoute } from '../lib/route';
import { selectDirty, useWorkflow } from '../store/workflow';
import { useUi } from '../store/ui';

function BuildHeader({ onDescribed }: { onDescribed: (r: DescribeResult) => void }) {
  const name = useWorkflow((s) => s.name);
  const issues = useWorkflow((s) => s.issues);
  const saving = useWorkflow((s) => s.saving);
  const dirty = useWorkflow(selectDirty);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const blocked = hasErrors(issues);

  const describe = (): void => {
    if (prompt.trim().length < 3 || busy) return;
    setBusy(true);
    void describeFromPrompt(prompt.trim())
      .then((r) => {
        if (r) {
          onDescribed(r);
          setPrompt('');
        }
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="glass runhdr">
      <span className="sg" style={{ fontWeight: 600 }}>BUILD · {name}</span>
      <span className="chip" style={{ color: blocked ? 'var(--bad)' : 'var(--amber)' }}>{blocked ? `${errors} ERROR${errors > 1 ? 'S' : ''}` : 'VALID'}</span>
      <button id="bRun" className={blocked ? '' : 'glow'} disabled={blocked} title={blocked ? 'Fix validation errors first' : 'Run (saves a new version if changed)'} onClick={() => void startRun()}>
        <Icon name="play" /> Run
      </button>
      <button disabled={!dirty || saving} onClick={() => void saveWorkflow()} title="⌘S">{saving ? 'Saving…' : 'Save'}</button>
      <input
        placeholder={busy ? 'Describing…' : 'Describe what should happen… (Enter)'}
        aria-label="Describe workflow"
        value={prompt}
        disabled={busy}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') describe();
        }}
      />
    </div>
  );
}

function DescribeCard({ result, onClose }: { result: DescribeResult; onClose: () => void }) {
  return (
    <div className="glass dcard" role="status">
      <div className="row">
        <span className="mic" style={{ color: 'var(--ok)' }}>GENERATED · {result.name}</span>
        <span className="chip" style={{ color: result.source === 'llm' ? 'var(--ok)' : 'var(--amber)' }}>{result.source === 'llm' ? (result.model ?? 'model') : 'cached sample'}</span>
        <span className="sp" />
        <button onClick={onClose} aria-label="Dismiss">×</button>
      </div>
      {result.note && <p className="mic" style={{ letterSpacing: 0, textTransform: 'none', margin: '6px 0' }}>{result.note}</p>}
      <p className="mic" style={{ marginTop: 8 }}>Validation transcript</p>
      {result.transcript.map((r) => (
        <div key={r.round} className="m" style={{ fontSize: 11, marginTop: 4 }}>
          <span style={{ color: 'var(--t2)' }}>round {r.round}</span>
          {r.issues.length === 0 ? <span style={{ color: 'var(--ok)' }}> · all checks pass</span> : r.issues.map((i, k) => (
            <div key={k} style={{ color: i.severity === 'error' ? 'var(--bad)' : 'var(--amber)' }}>{i.severity === 'error' ? '✕' : '△'} {i.message}</div>
          ))}
        </div>
      ))}
      <p className="mic" style={{ marginTop: 8, letterSpacing: 0, textTransform: 'none' }}>Applied to the canvas but not saved. ⌘S saves it as a new version.</p>
    </div>
  );
}

function Palette() {
  const [open, setOpen] = useState(true);
  const addNode = useWorkflow((s) => s.addNode);
  return (
    <div className="glass pal">
      <button style={{ width: '100%' }} onClick={() => setOpen(!open)} aria-expanded={open}>Nodes {open ? '▾' : '▸'}</button>
      {open && (
        <div style={{ marginTop: 6 }}>
          {NODE_TYPES.map((t) => (
            <button
              key={t}
              className="pi"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, t);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => addNode(t)}
              title="Drag onto the canvas, or click to add"
            >
              <span style={{ color: TYPE_META[t].color }}><Icon name={TYPE_META[t].icon} /></span> {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Builder() {
  const s = useWorkflow();
  const showToast = useUi((u) => u.showToast);
  const [described, setDescribed] = useState<DescribeResult | null>(null);
  return (
    <>
      <div className="cv">
        <div className="bloom" />
        <FlowCanvas
          canvasKey={`${s.id}@${s.version}#${s.epoch}`}
          nodes={s.nodes}
          edges={s.edges}
          issues={s.issues}
          selectedNodeId={s.selectedNodeId}
          editable
          onSelectNode={s.select}
          onMoveNode={s.moveNode}
          onRemoveNodes={s.removeNodes}
          onRemoveEdges={s.removeEdges}
          onConnect={(c) => {
            const reason = s.connect(c);
            if (reason) showToast(reason);
          }}
          onDropNode={(t: NodeType, pos) => s.addNode(t, pos)}
        />
        <BuildHeader onDescribed={setDescribed} />
        {described && <DescribeCard result={described} onClose={() => setDescribed(null)} />}
        <Palette />
        <div className="hint">BUILD · drag from the palette · connect ports · scroll to zoom · double-click a node to focus</div>
      </div>
      <ValidationPanel />
      <Inspector />
    </>
  );
}

export function BuildView() {
  const { id: routeId } = useRoute();
  const loadState = useWorkflow((s) => s.loadState);
  const loadError = useWorkflow((s) => s.loadError);

  useEffect(() => {
    void useWorkflow.getState().bootstrap(routeId);
  }, [routeId]);

  return (
    <>
      {(loadState === 'idle' || loadState === 'loading') && <div className="cv"><Loading text="Loading workflow…" /></div>}
      {loadState === 'error' && <div className="cv"><ErrorState message={loadError ?? 'Unknown error'} onRetry={() => void useWorkflow.getState().bootstrap(routeId)} /></div>}
      {loadState === 'empty' && <div className="cv"><NoWorkflows /></div>}
      {loadState === 'ready' && <Builder />}
    </>
  );
}