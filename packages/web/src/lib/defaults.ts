import type { NodeType, Position, WorkflowNode } from '@tharion/engine';

export function makeNode(type: NodeType, id: string, position: Position): WorkflowNode {
  switch (type) {
    case 'trigger':
      return { id, position, type, label: 'Trigger', config: { kind: 'manual', samplePayload: {} } };
    case 'http':
      return { id, position, type, label: 'HTTP Request', config: { method: 'GET', url: 'mock://ok', headers: {}, timeoutMs: 3000 } };
    case 'transform':
      return { id, position, type, label: 'Transform', config: { expression: '$' } };
    case 'condition':
      return { id, position, type, label: 'Condition', config: { expression: 'true' } };
    case 'delay':
      return { id, position, type, label: 'Delay', config: { ms: 1000 } };
    case 'notify':
      return { id, position, type, label: 'Notify', config: { channel: 'email', template: 'Hello' } };
    case 'output':
      return { id, position, type, label: 'Output', config: { label: 'result' } };
  }
}

export function uniqueId(type: NodeType, nodes: readonly WorkflowNode[]): string {
  const used = new Set(nodes.map((n) => n.id));
  let i = 1;
  while (used.has(`${type}_${i}`)) i++;
  return `${type}_${i}`;
}

export function nextPosition(nodes: readonly WorkflowNode[]): Position {
  if (nodes.length === 0) return { x: 0, y: 0 };
  const maxX = Math.max(...nodes.map((n) => n.position.x));
  return { x: Math.round((maxX + 255) / 20) * 20, y: 140 };
}