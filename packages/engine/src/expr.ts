import jsonata from 'jsonata';
import type { Json } from './types';
import { errorMessage, toJson } from './util';

type Compiled = ReturnType<typeof jsonata>;
const cache = new Map<string, Compiled>();

function compile(expression: string): Compiled {
  let c = cache.get(expression);
  if (!c) {
    if (cache.size > 500) cache.clear();
    c = jsonata(expression);
    cache.set(expression, c);
  }
  return c;
}

/** Returns a parse error message, or null if the expression parses. */
export function expressionError(expression: string): string | null {
  try {
    compile(expression);
    return null;
  } catch (e) {
    return errorMessage(e);
  }
}

export async function evaluateExpression(expression: string, data: Json): Promise<Json> {
  const raw: unknown = await compile(expression).evaluate(data);
  return toJson(raw);
}

const TEMPLATE_RE = /\{\{([\s\S]*?)\}\}/g;

export function templateExpressions(template: string): string[] {
  return [...template.matchAll(TEMPLATE_RE)].map((m) => (m[1] ?? '').trim());
}

function stringify(v: Json): string {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** Renders `{{ jsonata }}` placeholders against `data`. */
export async function renderTemplate(template: string, data: Json): Promise<string> {
  const parts: string[] = [];
  let last = 0;
  for (const m of template.matchAll(TEMPLATE_RE)) {
    const idx = m.index ?? 0;
    parts.push(template.slice(last, idx));
    parts.push(stringify(await evaluateExpression((m[1] ?? '').trim(), data)));
    last = idx + m[0].length;
  }
  parts.push(template.slice(last));
  return parts.join('');
}