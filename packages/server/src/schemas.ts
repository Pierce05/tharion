import { z } from 'zod';
import type { Json, JsonObject } from '@tharion/engine';

export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(jsonSchema), z.record(jsonSchema)]),
);
export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(jsonSchema);

const retrySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10),
  backoff: z.enum(['fixed', 'exponential']),
  baseMs: z.number().int().min(0).max(60_000),
});
const portType = z.enum(['string', 'number', 'boolean', 'object', 'array', 'any']);
const base = {
  id: z.string().min(1).max(64),
  label: z.string().max(120),
  position: z.object({ x: z.number(), y: z.number() }),
  retry: retrySchema.optional(),
};

export const nodeSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('trigger'),
    config: z.object({ kind: z.enum(['manual', 'webhook']), samplePayload: jsonSchema }),
  }),
  z.object({
    ...base,
    type: z.literal('http'),
    config: z.object({
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      url: z.string().min(1),
      headers: z.record(z.string()),
      body: z.string().optional(),
      timeoutMs: z.number().int().min(1).max(60_000),
    }),
  }),
  z.object({
    ...base,
    type: z.literal('transform'),
    config: z.object({ expression: z.string(), outputType: portType.optional() }),
  }),
  z.object({ ...base, type: z.literal('condition'), config: z.object({ expression: z.string() }) }),
  z.object({ ...base, type: z.literal('delay'), config: z.object({ ms: z.number().int().min(0).max(60_000) }) }),
  z.object({
    ...base,
    type: z.literal('notify'),
    config: z.object({ channel: z.string().min(1), template: z.string() }),
  }),
  z.object({ ...base, type: z.literal('output'), config: z.object({ label: z.string() }) }),
]);

const handle = z.enum(['in', 'out', 'true', 'false']);
export const edgeSchema = z.object({
  id: z.string().min(1).max(128),
  source: z.string().min(1),
  sourceHandle: handle,
  target: z.string().min(1),
  targetHandle: handle,
});

export const definitionSchema = z.object({
  nodes: z.array(nodeSchema).max(200),
  edges: z.array(edgeSchema).max(500),
});

export const faultsSchema = z.object({
  failNodes: z.array(z.object({ nodeId: z.string(), times: z.number().int().min(1).max(10) })).optional(),
  slowNodes: z.array(z.object({ nodeId: z.string(), ms: z.number().int().min(0).max(60_000) })).optional(),
  crashAfterEffect: z.string().optional(),
});

export const workflowIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);