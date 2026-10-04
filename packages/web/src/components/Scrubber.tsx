import { useMemo, useRef } from 'react';
import type { RunEvent, WorkflowNode } from '@tharion/engine';
import { EVENT_COLORS } from '../lib/nodeMeta';
import { cursorToPct, pctToCursor } from '../lib/rewind';

export const LANE_H = 13;
export const scrubberHeight = (nodeCount: number): number => (nodeCount + 1) * LANE_H + 26;

interface Lane {
  id: string | null;
  label: string;
  bars: { left: number; width: number; color: string }[];
  ticks: { left: number; color: string; rec: boolean; title: string }[];
}

interface Props {
  nodes: WorkflowNode[];
  events: RunEvent[];
  positions: number[];
  cursor: number;
  selectedNodeId: string | null;
  onSeek: (cursor: number) => void;
}

export function Scrubber({ nodes, events, positions, cursor, selectedNodeId, onSeek }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const t0 = events[0]?.ts ?? 0;

  const lanes = useMemo<Lane[]>(() => {
    const defs: { id: string | null; label: string }[] = [{ id: null, label: 'RUN' }, ...nodes.map((n) => ({ id: n.id, label: n.label }))];
    return defs.map((d) => {
      const bars: Lane['bars'] = [];
      const ticks: Lane['ticks'] = [];
      let start = -1;
      events.forEach((e, i) => {
        if (e.nodeId !== d.id) return;
        const x = positions[i] ?? 0;
        if (e.type === 'NODE_STARTED') start = i;
        else if (start >= 0 && (e.type === 'NODE_SUCCEEDED' || e.type === 'NODE_FAILED_ATTEMPT' || e.type === 'NODE_FAILED')) {
          const l = positions[start] ?? 0;
          bars.push({ left: l, width: Math.max(0.4, x - l), color: EVENT_COLORS[e.type] ?? '#888' });
          start = -1;
        }
        if (e.type !== 'NODE_SCHEDULED' && e.type !== 'NODE_STARTED') {
          ticks.push({
            left: x,
            color: EVENT_COLORS[e.type] ?? '#888',
            rec: e.type === 'RUN_RECOVERED',
            title: `${e.type} · seq ${e.seq} · +${((e.ts - t0) / 1000).toFixed(3)}s`,
          });
        }
      });
      if (start >= 0) {
        const l = positions[start] ?? 0;
        bars.push({ left: l, width: Math.max(0.4, 100 - l), color: '#FFB547' });
      }
      return { ...d, bars, ticks };
    });
  }, [nodes, events, positions, t0]);

  const labels = useMemo(() => {
    const out: { left: number; text: string }[] = [];
    if (events.length === 0) return out;
    const seen = new Set<number>();
    for (let k = 0; k <= 5; k++) {
      const target = k * 20;
      let best = 0;
      for (let i = 1; i < positions.length; i++) {
        if (Math.abs((positions[i] ?? 0) - target) < Math.abs((positions[best] ?? 0) - target)) best = i;
      }
      if (seen.has(best)) continue;
      seen.add(best);
      out.push({ left: positions[best] ?? 0, text: `T+${(((events[best]?.ts ?? t0) - t0) / 1000).toFixed(1)}s` });
    }
    return out;
  }, [events, positions, t0]);

  const seek = (clientX: number): void => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pct = ((clientX - r.left) / r.width) * 100;
    onSeek(pctToCursor(positions, Math.max(0, Math.min(100, pct))));
  };

  return (
    <div
      className="scrubber"
      ref={ref}
      style={{ height: scrubberHeight(nodes.length) }}
      role="slider"
      aria-label="Run timeline"
      aria-valuemin={0}
      aria-valuemax={events.length}
      aria-valuenow={cursor}
      onPointerDown={(e) => {
        drag.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        seek(e.clientX);
      }}
      onPointerMove={(e) => {
        if (drag.current) seek(e.clientX);
      }}
      onPointerUp={(e) => {
        drag.current = false;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* not captured */
        }
      }}
      onPointerCancel={() => {
        drag.current = false;
      }}
    >
      <div className="ruler">
        {labels.map((l) => (
          <b key={l.left} style={{ left: `${l.left}%` }}>{l.text}</b>
        ))}
      </div>
      {lanes.map((lane, i) => (
        <div key={lane.id ?? 'run'} className={`lane${lane.id === selectedNodeId ? ' sel' : ''}`} style={{ top: 20 + i * LANE_H }}>
          <span>{lane.label}</span>
          {lane.bars.map((b, k) => (
            <div key={k} className="bar" style={{ left: `${b.left}%`, width: `${b.width}%`, background: b.color }} />
          ))}
          {lane.ticks.map((t, k) => (
            <div key={k} className={`tick${t.rec ? ' rec' : ''}`} title={t.title} style={{ left: `${t.left}%`, background: t.color }} />
          ))}
        </div>
      ))}
      <div className="playhead" style={{ left: `${cursorToPct(positions, cursor)}%` }} />
    </div>
  );
}