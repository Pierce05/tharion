import { memo, type CSSProperties, type ReactNode } from 'react';
import { Handle, Position as Side, type Node, type NodeProps } from '@xyflow/react';
import { inputPort, outputPort, type NodeStatus, type WorkflowNode } from '@tharion/engine';
import { Icon } from './Icons';
import { PORT_COLORS, TYPE_META, subOf } from '../lib/nodeMeta';

export interface NodeView {
  status: NodeStatus;
  attempt?: number;
  maxAttempts?: number;
  durationMs?: number;
  replayed?: boolean;
  resumed?: boolean;
  stalled?: boolean;
  playhead?: boolean;
  diverged?: boolean;
}

export interface NodeCardData extends Record<string, unknown> {
  node: WorkflowNode;
  view?: NodeView;
  issue?: string;
  dim?: boolean;
}
export type TharionNode = Node<NodeCardData, 'tharion'>;

const STATUS_CLASS: Record<NodeStatus, string> = {
  pending: 'pending',
  running: 'run',
  succeeded: 'ok',
  failed: 'fail',
  skipped: 'skip',
  retrying: 'retry',
};

function statusText(node: WorkflowNode, v?: NodeView): ReactNode {
  if (!v) return <span>{node.type}</span>;
  if (v.replayed) return (<><Icon name="fork" className="sm" /> replayed (not re-executed)</>);
  switch (v.status) {
    case 'succeeded':
      return (<><Icon name="check" className="sm ck" /> {v.durationMs ?? 0}ms</>);
    case 'failed':
      return '✕ failed';
    case 'skipped':
      return 'skipped';
    case 'retrying':
      return `↻ ${(v.attempt ?? 0) + 1}/${v.maxAttempts ?? 3}`;
    case 'running':
      return v.stalled ? 'stalled' : v.resumed ? `attempt ${v.attempt ?? 1} (resumed)` : `running · attempt ${v.attempt ?? 1}`;
    default:
      return '';
  }
}

export const NodeCard = memo(function NodeCard({ data, selected }: NodeProps<TharionNode>) {
  const { node, view, issue, dim } = data;
  const meta = TYPE_META[node.type];
  const inT = inputPort(node)?.type;
  const outT = outputPort(node)?.type;

  const cls = ['node-card'];
  if (!view) cls.push('design');
  else cls.push(view.replayed ? 'ghost' : STATUS_CLASS[view.status]);
  if (view?.stalled) cls.push('stalled');
  if (view?.playhead) cls.push('ph');
  if (view?.diverged) cls.push('div');
  if (selected) cls.push('sel');
  if (dim) cls.push('dim');
  if (issue) cls.push('invalid');

  return (
    <div className="nw" title={issue}>
      <div className={cls.join(' ')} style={{ '--c': meta.color } as CSSProperties}>
        <div className="ic"><Icon name={meta.icon} /></div>
        <div className="tx">
          <b>{node.label}</b>
          <i>{subOf(node)}</i>
        </div>
        {issue && <span className="badge" aria-label="validation error">!</span>}
        <span className="st">{statusText(node, view)}</span>
      </div>
      {inT && <Handle type="target" position={Side.Left} id="in" style={{ background: PORT_COLORS[inT] }} />}
      {node.type === 'condition' ? (
        <>
          <Handle type="source" position={Side.Right} id="true" style={{ top: 24, background: '#3DDC97' }} />
          <Handle type="source" position={Side.Right} id="false" style={{ top: 52, background: '#8A93A8' }} />
        </>
      ) : (
        outT && <Handle type="source" position={Side.Right} id="out" style={{ background: PORT_COLORS[outT] }} />
      )}
    </div>
  );
});