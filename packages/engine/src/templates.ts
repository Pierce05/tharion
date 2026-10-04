import type { Handle, WorkflowDefinition, WorkflowEdge, WorkflowNode } from './types';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  definition: WorkflowDefinition;
}

const edge = (source: string, target: string, sourceHandle: Handle = 'out'): WorkflowEdge => ({
  id: `${source}:${sourceHandle}->${target}`,
  source,
  sourceHandle,
  target,
  targetHandle: 'in',
});

const RETRY = (): { maxAttempts: number; backoff: 'exponential'; baseMs: number } => ({
  maxAttempts: 3,
  backoff: 'exponential',
  baseMs: 400,
});

const orderIntakeNodes: WorkflowNode[] = [
  {
    id: 'webhook',
    type: 'trigger',
    label: 'Webhook',
    position: { x: 0, y: 150 },
    config: { kind: 'webhook', samplePayload: { customer: { name: 'Aditi', age: 34 }, amount: 12000 } },
  },
  {
    id: 'fetch_customer',
    type: 'http',
    label: 'Fetch Customer',
    position: { x: 255, y: 150 },
    retry: RETRY(),
    config: { method: 'POST', url: 'mock://fail-once/customers', headers: {}, body: '{{ $ }}', timeoutMs: 3000 },
  },
  {
    id: 'normalize',
    type: 'transform',
    label: 'Normalize',
    position: { x: 510, y: 150 },
    config: {
      outputType: 'object',
      expression: `{
  "customer": body.echo.customer,
  "amount": body.echo.amount,
  "isAdult": $type(body.echo.customer.age) = "number" ? body.echo.customer.age >= 18 : null
}`,
    },
  },
  {
    id: 'condition',
    type: 'condition',
    label: 'Amount >= 10,000?',
    position: { x: 765, y: 20 },
    config: { expression: 'amount >= 10000' },
  },
  {
    id: 'enrich',
    type: 'http',
    label: 'Enrich (slow)',
    position: { x: 765, y: 290 },
    config: { method: 'POST', url: 'mock://slow/enrich', headers: {}, body: '{{ $ }}', timeoutMs: 8000 },
  },
  {
    id: 'request_approval',
    type: 'notify',
    label: 'Request Approval',
    position: { x: 1020, y: 0 },
    config: { channel: 'email', template: 'Approval needed: {{ customer.name }} for {{ amount }}' },
  },
  {
    id: 'auto_process',
    type: 'transform',
    label: 'Auto-process',
    position: { x: 1020, y: 140 },
    config: { outputType: 'object', expression: '$merge([$, {"route": "auto"}])' },
  },
  {
    id: 'join',
    type: 'transform',
    label: 'Join',
    position: { x: 1275, y: 150 },
    config: {
      outputType: 'object',
      expression: `{
  "customer": enrich.body.echo.customer,
  "amount": enrich.body.echo.amount,
  "isAdult": enrich.body.echo.isAdult,
  "route": $exists(request_approval) ? "approval" : "auto"
}`,
    },
  },
  {
    id: 'compose',
    type: 'transform',
    label: 'Compose Message',
    position: { x: 1530, y: 150 },
    config: {
      outputType: 'object',
      expression: `$type(isAdult) = "null"
  ? $error("isAdult is null: customer.age must be a number, got " & $type(customer.age))
  : {"to": customer.name, "isAdult": isAdult, "route": route, "amount": amount}`,
    },
  },
  {
    id: 'notify_customer',
    type: 'notify',
    label: 'Notify Customer',
    position: { x: 1785, y: 150 },
    config: { channel: 'email', template: 'Hi {{ to }}, adult={{ isAdult }}' },
  },
  { id: 'output', type: 'output', label: 'Output', position: { x: 2040, y: 150 }, config: { label: 'result' } },
];

const orderIntake: WorkflowDefinition = {
  nodes: orderIntakeNodes,
  edges: [
    edge('webhook', 'fetch_customer'),
    edge('fetch_customer', 'normalize'),
    edge('normalize', 'condition'),
    edge('normalize', 'enrich'),
    edge('condition', 'request_approval', 'true'),
    edge('condition', 'auto_process', 'false'),
    edge('request_approval', 'join'),
    edge('auto_process', 'join'),
    edge('enrich', 'join'),
    edge('join', 'compose'),
    edge('compose', 'notify_customer'),
    edge('notify_customer', 'output'),
  ],
};

const flakyApi: WorkflowDefinition = {
  nodes: [
    { id: 'start', type: 'trigger', label: 'Manual Start', position: { x: 0, y: 40 }, config: { kind: 'manual', samplePayload: { id: 42 } } },
    {
      id: 'fetch',
      type: 'http',
      label: 'Flaky API',
      position: { x: 280, y: 40 },
      retry: RETRY(),
      config: { method: 'POST', url: 'mock://fail-once/orders/{{ id }}', headers: {}, body: '{{ $ }}', timeoutMs: 3000 },
    },
    {
      id: 'shape',
      type: 'transform',
      label: 'Shape Result',
      position: { x: 560, y: 40 },
      config: { outputType: 'object', expression: '{"status": status, "ok": body.ok, "id": body.echo.id}' },
    },
    { id: 'out', type: 'output', label: 'Output', position: { x: 840, y: 40 }, config: { label: 'result' } },
  ],
  edges: [edge('start', 'fetch'), edge('fetch', 'shape'), edge('shape', 'out')],
};

const ageGate: WorkflowDefinition = {
  nodes: [
    {
      id: 'start',
      type: 'trigger',
      label: 'Manual Start',
      position: { x: 0, y: 100 },
      config: { kind: 'manual', samplePayload: { customer: { name: 'Aditi', age: 'twenty' } } },
    },
    {
      id: 'normalize',
      type: 'transform',
      label: 'Normalize',
      position: { x: 280, y: 100 },
      config: {
        outputType: 'object',
        expression: '{"name": customer.name, "isAdult": $type(customer.age) = "number" ? customer.age >= 18 : null}',
      },
    },
    { id: 'gate', type: 'condition', label: 'Is adult?', position: { x: 560, y: 100 }, config: { expression: 'isAdult = true' } },
    { id: 'out_adult', type: 'output', label: 'Adult', position: { x: 840, y: 0 }, config: { label: 'adult' } },
    { id: 'out_blocked', type: 'output', label: 'Blocked', position: { x: 840, y: 200 }, config: { label: 'blocked' } },
  ],
  edges: [edge('start', 'normalize'), edge('normalize', 'gate'), edge('gate', 'out_adult', 'true'), edge('gate', 'out_blocked', 'false')],
};

export const TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'order-intake',
    name: 'Order Intake',
    description: 'Webhook → fetch → normalize → condition → parallel approval / enrich → join → notify. Retry, branching, fan-in, effects.',
    definition: orderIntake,
  },
  {
    id: 'flaky-api',
    name: 'Flaky API Pipeline',
    description: 'An HTTP node that fails once (mock://fail-once) and recovers through retry with exponential backoff.',
    definition: flakyApi,
  },
  {
    id: 'age-gate',
    name: 'Age Gate',
    description: 'The "twenty" vs 20 story: fork at Normalize, change the age, watch isAdult flip from null to true.',
    definition: ageGate,
  },
];

export function blankDefinition(): WorkflowDefinition {
  return {
    nodes: [
      { id: 'trigger_1', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: { kind: 'manual', samplePayload: {} } },
      { id: 'output_1', type: 'output', label: 'Output', position: { x: 300, y: 0 }, config: { label: 'result' } },
    ],
    edges: [edge('trigger_1', 'output_1')],
  };
}

/** Deep copy so callers can mutate freely. */
export function cloneDefinition(def: WorkflowDefinition): WorkflowDefinition {
  return JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
}