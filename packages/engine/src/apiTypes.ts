import type { Json, RunStatus, WorkflowDefinition } from './types';

export interface Investigation {
  rootCause: string;
  firstBadNodeId: string | null;
  evidence: { eventSeq: number; quote: string }[];
  suggestedFix: string;
  suggestedForkInput?: Json;
  droppedEvidence: number;
  source: 'llm' | 'cached';
  model?: string;
  note?: string;
}

export interface DescribeIssue {
  severity: 'error' | 'warning';
  message: string;
}
export interface DescribeRound {
  round: number;
  issues: DescribeIssue[];
}
export interface DescribeResult {
  name: string;
  definition: WorkflowDefinition;
  transcript: DescribeRound[];
  source: 'llm' | 'cached';
  model?: string;
  note?: string;
}

export interface LineageNode {
  id: string;
  parentRunId: string | null;
  forkedAtNodeId: string | null;
  status: RunStatus;
  createdAt: number;
}
export interface Lineage {
  rootId: string;
  nodes: LineageNode[];
}

export interface TestReport {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  success: boolean;
  startTime: number | null;
  files: { file: string; tests: { name: string; status: string; durationMs: number }[] }[];
}