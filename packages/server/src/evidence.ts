import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { TestReport } from '@tharion/engine';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const EVIDENCE_PATH = resolve(ROOT, 'evidence/test-results.json');

const schema = z.object({
  numTotalTests: z.number(),
  numPassedTests: z.number(),
  numFailedTests: z.number(),
  numPendingTests: z.number().optional(),
  success: z.boolean().optional(),
  startTime: z.number().optional(),
  testResults: z.array(
    z.object({
      name: z.string(),
      assertionResults: z.array(
        z.object({ fullName: z.string().optional(), title: z.string(), status: z.string(), duration: z.number().nullable().optional() }),
      ),
    }),
  ),
});

export function summarizeVitestJson(raw: unknown, root: string = ROOT): TestReport | null {
  const p = schema.safeParse(raw);
  if (!p.success) return null;
  return {
    total: p.data.numTotalTests,
    passed: p.data.numPassedTests,
    failed: p.data.numFailedTests,
    skipped: p.data.numPendingTests ?? 0,
    success: p.data.success ?? p.data.numFailedTests === 0,
    startTime: p.data.startTime ?? null,
    files: p.data.testResults.map((f) => ({
      file: relative(root, f.name) || f.name,
      tests: f.assertionResults.map((t) => ({ name: t.fullName ?? t.title, status: t.status, durationMs: Math.round(t.duration ?? 0) })),
    })),
  };
}

export function readEvidence(path: string = EVIDENCE_PATH): TestReport | null {
  try {
    if (!existsSync(path)) return null;
    return summarizeVitestJson(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  } catch {
    return null;
  }
}

let running = false;
export const evidenceRunning = (): boolean => running;

/** Runs `pnpm test:evidence` (writes evidence/test-results.json). Returns false if already running. */
export function startTestRun(): boolean {
  if (running) return false;
  running = true;
  const child = spawn('pnpm', ['test:evidence'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
  const done = (): void => {
    running = false;
  };
  child.on('exit', done);
  child.on('error', done);
  return true;
}