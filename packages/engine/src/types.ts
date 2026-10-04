// ---------- JSON ----------
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

// ---------- Ports & types ----------
export type PortType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';
export interface PortSpec {
  type: PortType;
  shape?: { [field: string]: PortType };
}

// ---------- Workflow model (FR-W) ----------
export type NodeType = 'trigger' | 'http' | 'transform' | 'condition' | 'delay' | 'notify' | 'output';
export type Handle = 'in' | 'out' | 'true' | 'false';

export interface Position {
  x: number;
  y: number;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoff: 'fixed' | 'exponential';
  baseMs: number;
}

export interface TriggerConfig {
  kind: 'manual' | 'webhook';
  samplePayload: Json;
}
export interface HttpConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string; // template, supports mock://ok|slow|flaky|fail-once
  headers: { [name: string]: string };
  body?: string; // template
  timeoutMs: number;
}
export interface TransformConfig {
  expression: string; // JSONata
  outputType?: PortType; // declared output type, drives edge validation
}
export interface ConditionConfig {
  expression: string; // JSONata -> boolean
}
export interface DelayConfig {
  ms: number;
}
export interface NotifyConfig {
  channel: string;
  template: string;
}
export interface OutputConfig {
  label: string;
}

interface NodeBase<T extends NodeType, C> {
  id: string;
  type: T;
  label: string;
  config: C;
  position: Position;
  retry?: RetryPolicy;
}

export type TriggerNode = NodeBase<'trigger', TriggerConfig>;
export type HttpNode = NodeBase<'http', HttpConfig>;
export type TransformNode = NodeBase<'transform', TransformConfig>;
export type ConditionNode = NodeBase<'condition', ConditionConfig>;
export type DelayNode = NodeBase<'delay', DelayConfig>;
export type NotifyNode = NodeBase<'notify', NotifyConfig>;
export type OutputNode = NodeBase<'output', OutputConfig>;

export type WorkflowNode =
  | TriggerNode
  | HttpNode
  | TransformNode
  | ConditionNode
  | DelayNode
  | NotifyNode
  | OutputNode;

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle: Handle;
  target: string;
  targetHandle: Handle;
}

/** What is stored in workflows.definition (JSON). */
export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface Workflow extends WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  createdAt: number;
}

// ---------- Validation (FR-V) ----------
export type Severity = 'error' | 'warning';
export interface ValidationIssue {
  code: string;
  severity: Severity;
  nodeId?: string;
  edgeId?: string;
  message: string;
  fixHint?: string;
}

// ---------- Faults (FR-C3) ----------
export interface RunFaults {
  failNodes?: { nodeId: string; times: number }[];
  slowNodes?: { nodeId: string; ms: number }[];
  /** Hard-exit the worker after the effect is claimed but before the event commit (test 8). */
  crashAfterEffect?: string;
}

// ---------- Events (append-only) ----------
interface EventBase {
  seq: number;
  runId: string;
  ts: number;
  nodeId: string | null;
  attempt: number | null;
}

export type RunEventBody =
  | {
      type: 'RUN_STARTED';
            data: { workflowVersion: number; triggerPayload: Json; parentRunId?: string; forkedAtNodeId?: string; inputOverride?: Json };
    }
  | { type: 'NODE_SCHEDULED'; data: Record<string, never> }
  | { type: 'NODE_STARTED'; data: { input: Json } }
  | { type: 'NODE_SUCCEEDED'; data: { output: Json; durationMs: number; handle?: Handle } }
  | { type: 'NODE_FAILED_ATTEMPT'; data: { error: string; durationMs?: number } }
  | { type: 'RETRY_SCHEDULED'; data: { at: number } }
  | { type: 'NODE_FAILED'; data: { error: string } }
  | { type: 'NODE_SKIPPED'; data: { reason: string } }
  | { type: 'NODE_REPLAYED'; data: { fromRunId: string; input: Json; output: Json; handle?: Handle } }
  | { type: 'RUN_RECOVERED'; data: { workerId: string } }
  | { type: 'RUN_COMPLETED'; data: { result: Json } }
  | { type: 'RUN_FAILED'; data: { nodeId: string; error: string } }
  | { type: 'RUN_CANCELLED'; data: Record<string, never> };

export type EventType = RunEventBody['type'];
export type RunEvent = EventBase & RunEventBody;
/** What the executor appends; seq and ts are assigned by the store. */
export type NewEvent = { runId: string; nodeId: string | null; attempt: number | null } & RunEventBody;

// ---------- Derived run state (reducer output) ----------
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type NodeStatus = 'pending' | 'running' | 'retrying' | 'succeeded' | 'failed' | 'skipped';

export interface NodeState {
  status: NodeStatus;
  attempt: number;
  input?: Json;
  output?: Json;
  error?: string;
  handle?: Handle;
  replayed?: boolean;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  retryAt?: number;
}

export interface EdgeState {
  resolved: boolean;
  taken: boolean;
  payload?: Json;
}

export interface RunState {
  status: RunStatus;
  nodes: Record<string, NodeState>;
  edges: Record<string, EdgeState>;
  cursor: number;
}

// ---------- DB records ----------
export interface RunRecord {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: RunStatus;
  triggerPayload: Json;
  parentRunId: string | null;
  forkedAtNodeId: string | null;
  dryRun: boolean;
  faults: RunFaults | null;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface OutboxRow {
  id: number;
  runId: string;
  nodeId: string;
  channel: string;
  payload: Json;
  createdAt: number;
}