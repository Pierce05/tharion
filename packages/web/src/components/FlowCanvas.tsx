import { useCallback, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import type { Handle, Json, NodeType, Position, ValidationIssue, WorkflowEdge, WorkflowNode } from '@tharion/engine';
import { NodeCard, type NodeCardData, type NodeView, type TharionNode } from './NodeCard';
import { PacketEdge, type EdgeView, type TharionEdge } from './PacketEdge';
import { NODE_TYPES, TYPE_META } from '../lib/nodeMeta';

const nodeTypes = { tharion: NodeCard } as unknown as NodeTypes;
const edgeTypes = { packet: PacketEdge } as unknown as EdgeTypes;
export const DRAG_MIME = 'application/tharion-node';

export interface FlowCanvasProps {
  canvasKey: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  nodeViews?: Record<string, NodeView>;
  edgeViews?: Record<string, EdgeView>;
  edgePayloads?: Record<string, Json>;
  issues?: ValidationIssue[];
  selectedNodeId?: string | null;
  editable?: boolean;
  onSelectNode?: (id: string | null) => void;
  onMoveNode?: (id: string, pos: Position) => void;
  onRemoveNodes?: (ids: string[]) => void;
  onRemoveEdges?: (ids: string[]) => void;
  onConnect?: (c: { source: string; sourceHandle: Handle; target: string }) => void;
  onDropNode?: (type: NodeType, pos: Position) => void;
  children?: ReactNode;
}

function chainOf(id: string | null, edges: WorkflowEdge[]): Set<string> | null {
  if (!id) return null;
  const grow = (start: string, next: (e: WorkflowEdge) => [string, string]): Set<string> => {
    const seen = new Set([start]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of edges) {
        const [from, to] = next(e);
        if (seen.has(from) && !seen.has(to)) {
          seen.add(to);
          changed = true;
        }
      }
    }
    return seen;
  };
  const up = grow(id, (e) => [e.target, e.source]);
  const down = grow(id, (e) => [e.source, e.target]);
  return new Set([...up, ...down]);
}

function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <Panel position="bottom-right" className="zoom glass">
      <button aria-label="Zoom in" onClick={() => void zoomIn({ duration: 150 })}>+</button>
      <button aria-label="Zoom out" onClick={() => void zoomOut({ duration: 150 })}>−</button>
      <button onClick={() => void fitView({ padding: 0.15, maxZoom: 1, duration: 250 })}>Fit</button>
    </Panel>
  );
}

function Inner(p: FlowCanvasProps) {
  const { screenToFlowPosition, setCenter } = useReactFlow();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const editable = p.editable === true;

  const chain = useMemo(() => chainOf(hoverId, p.edges), [hoverId, p.edges]);
  const nodeIssue = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of p.issues ?? []) if (i.severity === 'error' && i.nodeId && !m.has(i.nodeId)) m.set(i.nodeId, i.message);
    return m;
  }, [p.issues]);
  const edgeIssue = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of p.issues ?? []) if (i.severity === 'error' && i.edgeId && !m.has(i.edgeId)) m.set(i.edgeId, i.message);
    return m;
  }, [p.issues]);

  const rfNodes: TharionNode[] = useMemo(
    () =>
      p.nodes.map((n) => ({
        id: n.id,
        type: 'tharion',
        position: n.position,
        selected: n.id === p.selectedNodeId,
        draggable: editable,
        data: { node: n, view: p.nodeViews?.[n.id], issue: nodeIssue.get(n.id), dim: chain ? !chain.has(n.id) : false },
      })),
    [p.nodes, p.nodeViews, p.selectedNodeId, nodeIssue, chain, editable],
  );

  const rfEdges: TharionEdge[] = useMemo(
    () =>
      p.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: 'packet',
        selected: e.id === selEdge,
        data: {
          handle: e.sourceHandle,
          view: p.edgeViews?.[e.id],
          payload: p.edgePayloads?.[e.id],
          issue: edgeIssue.get(e.id),
          chain: chain ? chain.has(e.source) && chain.has(e.target) : false,
        },
      })),
        [p.edges, p.edgeViews, p.edgePayloads, edgeIssue, chain, selEdge],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<TharionNode>[]) => {
      const removed: string[] = [];
      for (const c of changes) {
        if (c.type === 'position' && c.position && editable) p.onMoveNode?.(c.id, c.position);
        else if (c.type === 'remove' && editable) removed.push(c.id);
        else if (c.type === 'select' && c.selected) p.onSelectNode?.(c.id);
      }
      if (removed.length) p.onRemoveNodes?.(removed);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editable, p.onMoveNode, p.onRemoveNodes, p.onSelectNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<TharionEdge>[]) => {
      const removed: string[] = [];
      for (const c of changes) {
        if (c.type === 'remove' && editable) removed.push(c.id);
        else if (c.type === 'select') setSelEdge((cur) => (c.selected ? c.id : cur === c.id ? null : cur));
      }
      if (removed.length) p.onRemoveEdges?.(removed);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editable, p.onRemoveEdges],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      p.onConnect?.({ source: c.source, sourceHandle: (c.sourceHandle as Handle | null) ?? 'out', target: c.target });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.onConnect],
  );

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const t = e.dataTransfer.getData(DRAG_MIME) as NodeType;
    if (!NODE_TYPES.includes(t)) return;
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    p.onDropNode?.(t, { x: Math.round((pos.x - 102) / 20) * 20, y: Math.round((pos.y - 38) / 20) * 20 });
  };

  return (
    <div
      style={{ position: 'absolute', inset: 0 }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={(c) => c.source !== c.target}
        onNodeMouseEnter={(_, n) => setHoverId(n.id)}
        onNodeMouseLeave={() => setHoverId(null)}
        onNodeDoubleClick={(_, n) => void setCenter(n.position.x + 102, n.position.y + 38, { zoom: 1, duration: 350 })}
        onPaneClick={() => {
          p.onSelectNode?.(null);
          setSelEdge(null);
        }}
        nodesDraggable={editable}
        nodesConnectable={editable}
        elementsSelectable
        deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
        snapToGrid
        snapGrid={[20, 20]}
        minZoom={0.2}
        maxZoom={1.6}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(255,255,255,.13)" />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          maskColor="rgba(5,6,10,.7)"
          nodeColor={(n) => {
            const d = n.data as unknown as NodeCardData | undefined;
            return d ? TYPE_META[d.node.type].color : '#555';
          }}
        />
        <ZoomControls />
        {p.children}
      </ReactFlow>
    </div>
  );
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider key={props.canvasKey}>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}