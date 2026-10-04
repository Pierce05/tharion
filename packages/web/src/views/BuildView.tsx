import { useEffect, useState } from 'react';
import { hasErrors, type NodeType } from '@tharion/engine';
import { FlowCanvas, DRAG_MIME } from '../components/FlowCanvas';
import { ErrorState, Loading, NoWorkflows } from '../components/EmptyState';
import { Icon } from '../components/Icons';
import { Inspector } from '../components/Inspector';
import { ValidationPanel } from '../components/ValidationPanel';
import { saveWorkflow, startRun } from '../lib/actions';
import { NODE_TYPES, TYPE_META } from '../lib/nodeMeta';
import { useRoute } from '../lib/route';
import { selectDirty, useWorkflow } from '../store/workflow';
import { useUi } from '../store/ui';

function BuildHeader() {
  const name = useWorkflow((s) => s.name);
  const issues = useWorkflow((s) => s.issues);
  const saving = useWorkflow((s) => s.saving);
  const dirty = useWorkflow(selectDirty);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const blocked = hasErrors(issues);
  return (
    <div className="glass runhdr">
      <span className="sg" style={{ fontWeight: 600 }}>BUILD · {name}</span>
      <span className="chip" style={{ color: blocked ? 'var(--bad)' : 'var(--amber)' }}>{blocked ? `${errors} ERROR${errors > 1 ? 'S' : ''}` : 'VALID'}</span>
      <button id="bRun" className={blocked ? '' : 'glow'} disabled={blocked} title={blocked ? 'Fix validation errors first' : 'Run (saves a new version if changed)'} onClick={() => void startRun()}>
        <Icon name="play" /> Run
      </button>
      <button disabled={!dirty || saving} onClick={() => void saveWorkflow()} title="⌘S">{saving ? 'Saving…' : 'Save'}</button>
      <input disabled placeholder="Describe what should happen… (AI · coming in Phase 6)" aria-label="Describe workflow" />
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
  return (
    <>
      <div className="cv">
        <div className="bloom" />
        <FlowCanvas
          canvasKey={`${s.id}@${s.version}`}
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
        <BuildHeader />
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