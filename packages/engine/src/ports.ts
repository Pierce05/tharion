import type { Handle, PortSpec, WorkflowNode } from './types';

export function inputPort(node: WorkflowNode): PortSpec | null {
  switch (node.type) {
    case 'trigger':
      return null;
    case 'http':
    case 'notify':
      return { type: 'object' };
    default:
      return { type: 'any' };
  }
}

export function outputPort(node: WorkflowNode): PortSpec | null {
  switch (node.type) {
    case 'trigger':
      return { type: 'object' };
    case 'http':
      return { type: 'object', shape: { status: 'number', body: 'any', headers: 'object' } };
    case 'transform':
      return { type: node.config.outputType ?? 'any' };
    case 'notify':
      return { type: 'object', shape: { messageId: 'string' } };
    case 'output':
      return null;
    default:
      return { type: 'any' }; // condition, delay: pass-through
  }
}

export function validSourceHandles(node: WorkflowNode): Handle[] {
  if (node.type === 'condition') return ['true', 'false'];
  if (node.type === 'output') return [];
  return ['out'];
}

export function describeType(p: PortSpec): string {
  if (!p.shape) return p.type;
  const fields = Object.entries(p.shape).map(([k, t]) => `${k}: ${t}`);
  return `${p.type} {${fields.join(', ')}}`;
}

/** Returns a human reason if `src` cannot flow into `tgt`, else null. */
export function assignable(src: PortSpec, tgt: PortSpec): string | null {
  if (src.type === 'any' || tgt.type === 'any') return null;
  if (src.type !== tgt.type) return `${src.type} is not assignable to ${tgt.type}`;
  if (tgt.shape && src.shape) {
    for (const [field, want] of Object.entries(tgt.shape)) {
      const have = src.shape[field];
      if (have === undefined) return `missing field "${field}"`;
      if (have !== 'any' && want !== 'any' && have !== want) return `field "${field}" is ${have}, expected ${want}`;
    }
  }
  return null;
}