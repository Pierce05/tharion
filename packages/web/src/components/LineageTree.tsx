import { useMemo } from 'react';
import type { Lineage, LineageNode } from '@tharion/engine';
import { navigate } from '../lib/route';

const COL = 78;
const ROW = 30;
const statusColor = (s: string): string => (s === 'failed' ? '#FF5C73' : s === 'completed' ? '#3DDC97' : '#FFB547');

export function LineageTree({ lineage, currentId }: { lineage: Lineage | null; currentId: string }) {
  const layout = useMemo(() => {
    if (!lineage || lineage.nodes.length < 2) return null;
    const kids = new Map<string, LineageNode[]>();
    for (const n of lineage.nodes) {
      if (!n.parentRunId) continue;
      const list = kids.get(n.parentRunId);
      if (list) list.push(n);
      else kids.set(n.parentRunId, [n]);
    }
    const pos = new Map<string, { x: number; y: number }>();
    let leaf = 0;
    const walk = (id: string, depth: number): number => {
      const ch = kids.get(id) ?? [];
      let y: number;
      if (ch.length === 0) y = leaf++;
      else {
        const ys = ch.map((c) => walk(c.id, depth + 1));
        y = ((ys[0] as number) + (ys[ys.length - 1] as number)) / 2;
      }
      pos.set(id, { x: depth, y });
      return y;
    };
    walk(lineage.rootId, 0);
    const depth = Math.max(...[...pos.values()].map((p) => p.x));
    return { pos, w: (depth + 1) * COL + 20, h: Math.max(1, leaf) * ROW + 12 };
  }, [lineage]);

  if (!lineage || !layout) return null;
  const at = (id: string): { x: number; y: number } => {
    const p = layout.pos.get(id) ?? { x: 0, y: 0 };
    return { x: 14 + p.x * COL, y: 14 + p.y * ROW };
  };

  return (
    <div className="glass lin" aria-label="Run lineage">
      <span className="mic">LINEAGE</span>
      <svg width={layout.w} height={layout.h} style={{ display: 'block', marginTop: 6 }}>
        {lineage.nodes.filter((n) => n.parentRunId).map((n) => {
          const a = at(n.parentRunId as string);
          const b = at(n.id);
          const mx = (a.x + b.x) / 2;
          return <path key={`e-${n.id}`} d={`M${a.x} ${a.y}C${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`} fill="none" stroke="#A78BFA" strokeWidth="1.5" />;
        })}
        {lineage.nodes.map((n) => {
          const p = at(n.id);
          const cur = n.id === currentId;
          return (
            <g key={n.id} style={{ cursor: 'pointer' }} onClick={() => navigate('rewind', n.id)}>
              <title>{`${n.id} · ${n.status}${n.forkedAtNodeId ? ` · forked at ${n.forkedAtNodeId}` : ''}`}</title>
              <circle cx={p.x} cy={p.y} r={cur ? 7 : 5} fill={statusColor(n.status)} stroke={cur ? '#4FD8FF' : 'none'} strokeWidth="2" />
              <text x={p.x + 10} y={p.y + 4} fontSize="10" fontFamily="JetBrains Mono" fill={cur ? '#F2F4F8' : '#8A93A8'}>{n.id.slice(-4)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}