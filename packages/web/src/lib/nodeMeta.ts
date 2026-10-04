import type { NodeType, PortType, WorkflowNode } from '@tharion/engine';
import type { IconName } from '../components/Icons';
import { truncate } from './format';

export const TYPE_META: Record<NodeType, { color: string; icon: IconName; label: string }> = {
  trigger: { color: '#FFB547', icon: 'bolt', label: 'Trigger' },
  http: { color: '#4FD8FF', icon: 'globe', label: 'HTTP' },
  transform: { color: '#A78BFA', icon: 'fx', label: 'Transform' },
  condition: { color: '#FBBF24', icon: 'branch', label: 'Condition' },
  delay: { color: '#94A3B8', icon: 'clock', label: 'Delay' },
  notify: { color: '#F472B6', icon: 'mail', label: 'Notify' },
  output: { color: '#3DDC97', icon: 'flag', label: 'Output' },
};

export const NODE_TYPES = Object.keys(TYPE_META) as NodeType[];

export const PORT_COLORS: Record<PortType, string> = {
  string: '#FBBF24',
  number: '#4FD8FF',
  boolean: '#F472B6',
  object: '#A78BFA',
  array: '#3DDC97',
  any: '#94A3B8',
};

export const EVENT_COLORS: Record<string, string> = {
  NODE_SUCCEEDED: '#3DDC97',
  NODE_FAILED_ATTEMPT: '#FF5C73',
  NODE_FAILED: '#FF5C73',
  RUN_FAILED: '#FF5C73',
  RETRY_SCHEDULED: '#FFB547',
  NODE_STARTED: '#FFB547',
  NODE_SKIPPED: '#8A93A8',
  NODE_REPLAYED: '#A78BFA',
  RUN_RECOVERED: '#4FD8FF',
  RUN_COMPLETED: '#3DDC97',
  RUN_STARTED: '#B4BBCB',
  NODE_SCHEDULED: '#8A93A8',
};

export function subOf(n: WorkflowNode): string {
  switch (n.type) {
    case 'trigger':
      return n.config.kind === 'webhook' ? 'webhook · POST /hooks' : 'manual';
    case 'http':
      return truncate(`${n.config.method} ${n.config.url}`, 24);
    case 'transform':
      return 'JSONata';
    case 'condition':
      return truncate(n.config.expression, 24);
    case 'delay':
      return `${n.config.ms} ms`;
    case 'notify':
      return `${n.config.channel} · template`;
    case 'output':
      return n.config.label;
  }
}