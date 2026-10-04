import { evaluateExpression, renderTemplate } from './expr';
import type { EffectWrite } from './store';
import type { Handle, HttpNode, Json, WorkflowNode } from './types';

export interface NodeContext {
  runId: string;
  nodeId: string;
  attempt: number;
  dryRun: boolean;
  sleep: (ms: number) => Promise<void>;
}

export interface NodeOutcome {
  output: Json;
  handle?: Handle;
  effect?: EffectWrite;
}

function parseMaybeJson(s: string | undefined): Json {
  if (s === undefined) return null;
  try {
    return JSON.parse(s) as Json;
  } catch {
    return s;
  }
}

export function mockHttpResult(mode: string, url: string, method: string, body: string | undefined): Json {
  return { status: 200, body: { ok: true, mode, method, url, echo: parseMaybeJson(body) }, headers: { 'x-mock': mode } };
}

/** Deterministic mock transport (FR-N3). Failure behavior is a function of the attempt number. */
async function runMock(mode: string, url: string, method: string, body: string | undefined, ctx: NodeContext): Promise<Json> {
  switch (mode) {
    case 'ok':
      break;
    case 'slow':
      await ctx.sleep(3000);
      break;
    case 'flaky': // fails attempts 1 and 2, succeeds on 3
      if (ctx.attempt < 3) throw new Error(`mock://flaky failed (attempt ${ctx.attempt} of 3)`);
      break;
    case 'fail-once': // fails attempt 1, succeeds from attempt 2
      if (ctx.attempt < 2) throw new Error('mock://fail-once failed on the first attempt');
      break;
    default:
      throw new Error(`unknown mock mode "${mode}"`);
  }
  return mockHttpResult(mode, url, method, body);
}

async function runHttp(node: HttpNode, input: Json, ctx: NodeContext): Promise<NodeOutcome> {
  const { config } = node;
  const url = (await renderTemplate(config.url, input)).trim();
  const body = config.body === undefined ? undefined : await renderTemplate(config.body, input);

  const mock = /^mock:\/\/([a-z-]+)/.exec(url);
  if (mock) return { output: await runMock(mock[1] ?? 'ok', url, config.method, body, ctx) };

  if (ctx.dryRun) return { output: { status: 200, body: { dryRun: true, url }, headers: {} } };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(url, {
      method: config.method,
      headers: config.headers,
      body: config.method === 'GET' ? undefined : body,
      signal: controller.signal,
    });
    const text = await res.text();
    if (res.status >= 500) throw new Error(`HTTP ${res.status} from ${url}`);
    const headers: { [k: string]: string } = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    return { output: { status: res.status, body: parseMaybeJson(text), headers } };
  } finally {
    clearTimeout(timer);
  }
}

export async function executeNode(node: WorkflowNode, input: Json, ctx: NodeContext): Promise<NodeOutcome> {
  switch (node.type) {
    case 'trigger':
    case 'output':
      return { output: input };
    case 'http':
      return runHttp(node, input, ctx);
    case 'transform':
      return { output: await evaluateExpression(node.config.expression, input) };
    case 'condition': {
      const r = await evaluateExpression(node.config.expression, input);
      if (r !== null && typeof r !== 'boolean') throw new Error(`condition must return a boolean, got ${typeof r}`);
      return { output: input, handle: r === true ? 'true' : 'false' };
    }
    case 'delay':
      await ctx.sleep(node.config.ms);
      return { output: input };
    case 'notify': {
      if (ctx.dryRun) return { output: { messageId: 'dry-run' } };
      const message = await renderTemplate(node.config.template, input);
      return {
        output: { messageId: `msg_${ctx.runId}_${ctx.nodeId}` },
        effect: { channel: node.config.channel, payload: { message } },
      };
    }
  }
}