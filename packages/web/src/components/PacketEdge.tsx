import { useState } from 'react';
import { EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import type { Handle, Json } from '@tharion/engine';
import { JsonView } from './JsonView';

export type EdgeView = 'idle' | 'done' | 'live';

export interface EdgeData extends Record<string, unknown> {
  handle: Handle;
  view?: EdgeView;
  issue?: string;
  chain?: boolean;
  payload?: Json;
}
export type TharionEdge = Edge<EdgeData, 'packet'>;

export function PacketEdge({ sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<TharionEdge>) {
  const [hover, setHover] = useState(false);
  const mx = (sourceX + targetX) / 2;
  const my = (sourceY + targetY) / 2;
  const d = `M${sourceX} ${sourceY}C${mx} ${sourceY} ${mx} ${targetY} ${targetX} ${targetY}`;
  const handle = data?.handle;
  const issue = data?.issue;
  const payload = data?.payload;
  const cls = [
    'edge',
    handle === 'true' && 'ct',
    handle === 'false' && 'cf',
    data?.view === 'done' && 'done',
    data?.view === 'live' && 'live',
    issue && 'bad',
    data?.chain && 'chain',
    selected && 'sel',
  ].filter(Boolean).join(' ');

  return (
    <>
      <path className={cls} d={d} />
      <g className="pk">
        <circle className="packet" r="4"><animateMotion dur="1s" repeatCount="indefinite" path={d} /></circle>
        <circle className="packet" r="3" style={{ opacity: 0.55 }}><animateMotion dur="1s" begin=".07s" repeatCount="indefinite" path={d} /></circle>
        <circle className="packet" r="2" style={{ opacity: 0.3 }}><animateMotion dur="1s" begin=".14s" repeatCount="indefinite" path={d} /></circle>
      </g>
      <path className="hit" d={d} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} />
      {(handle === 'true' || handle === 'false') && (
        <text x={mx} y={my - 8} className="elab" fill={handle === 'true' ? '#3DDC97' : '#8A93A8'}>{handle}</text>
      )}
      {hover && (issue || payload !== undefined) && (
        <EdgeLabelRenderer>
          <div className={`${issue ? 'etip' : 'echip'} glass`} style={{ transform: `translate(-50%, 0) translate(${mx}px, ${my + 12}px)` }}>
            {issue ? issue : <JsonView value={payload} />}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}