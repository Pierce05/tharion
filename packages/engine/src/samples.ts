import { evaluateExpression, renderTemplate } from './expr';
import { indexGraph } from './graph';
import { mockHttpResult } from './nodes';
import type { Json, WorkflowDefinition, WorkflowEdge } from './types';
import { errorMessage } from './util';

export interface NodeSample {
  input?: Json;
  output?: Json;
  rendered?: string;
  error?: string;
}

/** Sample-data propagation for the inspector preview. Pure; never performs side effects. */
export async function computeSamples(def: WorkflowDefinition): Promise<Record<string, NodeSample>> {
  const idx = indexGraph(def);
  const indeg = new Map<string, number>(def.nodes.map((n) => [n.id, 0]));
  for (const e of def.edges) {
    if (idx.nodes.has(e.source) && idx.nodes.has(e.target)) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const queue = def.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const e of idx.outbound.get(id) ?? []) {
      if (!idx.nodes.has(e.target)) continue;
      const d = (indeg.get(e.target) ?? 0) - 1;
      indeg.set(e.target, d);
      if (d === 0) queue.push(e.target);
    }
  }

  const out = new Map<string, Json>();
  const result: Record<string, NodeSample> = {};

  for (const id of order) {
    const node = idx.nodes.get(id);
    if (!node) continue;
    const inc: WorkflowEdge[] = (idx.inbound.get(id) ?? []).filter((e) => idx.nodes.has(e.source));
    let input: Json | undefined;
    if (node.type !== 'trigger') {
      if (inc.length === 1) input = out.get((inc[0] as WorkflowEdge).source);
      else if (inc.length > 1) {
        const merged: { [k: string]: Json } = {};
        let any = false;
        for (const e of inc) {
          const v = out.get(e.source);
          if (v !== undefined) {
            merged[e.source] = v;
            any = true;
          }
        }
        input = any ? merged : undefined;
      }
    }

    const sample: NodeSample = input === undefined ? {} : { input };
    try {
      switch (node.type) {
        case 'trigger':
          sample.output = node.config.samplePayload;
          break;
        case 'output':
        case 'delay':
          sample.output = input;
          break;
        case 'transform':
          if (input !== undefined) sample.output = await evaluateExpression(node.config.expression, input);
          break;
        case 'condition':
          if (input !== undefined) {
            const r = await evaluateExpression(node.config.expression, input);
            sample.rendered = `expression → ${JSON.stringify(r)}`;
            sample.output = input;
          }
          break;
        case 'notify':
          if (input !== undefined) {
            sample.rendered = await renderTemplate(node.config.template, input);
            sample.output = { messageId: 'sample' };
          }
          break;
        case 'http':
          if (input !== undefined) {
            const url = (await renderTemplate(node.config.url, input)).trim();
            const body = node.config.body === undefined ? undefined : await renderTemplate(node.config.body, input);
            sample.rendered = `${node.config.method} ${url}${body ? '\n' + body : ''}`;
            const m = /^mock:\/\/([a-z-]+)/.exec(url);
            if (m) sample.output = mockHttpResult(m[1] ?? 'ok', url, node.config.method, body);
          }
          break;
      }
    } catch (e) {
      sample.error = errorMessage(e);
      delete sample.output;
    }
    if (sample.output !== undefined) out.set(id, sample.output);
    result[id] = sample;
  }
  return result;
}