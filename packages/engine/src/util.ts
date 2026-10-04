import type { Json } from './types';

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

/** Normalises any JSONata/JS value into plain JSON (undefined and functions become null). */
export function toJson(v: unknown): Json {
  if (v === undefined) return null;
  const s = JSON.stringify(v);
  return s === undefined ? null : (JSON.parse(s) as Json);
}

/** Thrown by the crash fault hook; the worker replaces this with a real SIGKILL. */
export class SimulatedCrash extends Error {
  constructor() {
    super('simulated crash');
    this.name = 'SimulatedCrash';
  }
}