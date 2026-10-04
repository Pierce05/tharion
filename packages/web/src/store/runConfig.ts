import { create } from 'zustand';
import type { RunFaults } from '@tharion/engine';

export interface RunConfigState {
  payloadText: string;
  dryRun: boolean;
  failNodes: { nodeId: string; times: number }[];
  slowNodes: { nodeId: string; ms: number }[];
  crashAfterEffect: string | null;
  seed: (text: string) => void;
  setPayloadText: (t: string) => void;
  setDryRun: (v: boolean) => void;
  addFail: (nodeId: string, times: number) => void;
  addSlow: (nodeId: string, ms: number) => void;
  setCrash: (nodeId: string | null) => void;
  removeFail: (nodeId: string) => void;
  removeSlow: (nodeId: string) => void;
  clearFaults: () => void;
}

export function toFaults(c: Pick<RunConfigState, 'failNodes' | 'slowNodes' | 'crashAfterEffect'>): RunFaults | undefined {
  const f: RunFaults = {};
  if (c.failNodes.length) f.failNodes = c.failNodes;
  if (c.slowNodes.length) f.slowNodes = c.slowNodes;
  if (c.crashAfterEffect) f.crashAfterEffect = c.crashAfterEffect;
  return Object.keys(f).length ? f : undefined;
}

export const useRunConfig = create<RunConfigState>((set) => ({
  payloadText: '{}',
  dryRun: false,
  failNodes: [],
  slowNodes: [],
  crashAfterEffect: null,
  seed: (payloadText) => set({ payloadText }),
  setPayloadText: (payloadText) => set({ payloadText }),
  setDryRun: (dryRun) => set({ dryRun }),
  addFail: (nodeId, times) => set((s) => ({ failNodes: [...s.failNodes.filter((f) => f.nodeId !== nodeId), { nodeId, times }] })),
  addSlow: (nodeId, ms) => set((s) => ({ slowNodes: [...s.slowNodes.filter((f) => f.nodeId !== nodeId), { nodeId, ms }] })),
  setCrash: (crashAfterEffect) => set({ crashAfterEffect }),
  removeFail: (nodeId) => set((s) => ({ failNodes: s.failNodes.filter((f) => f.nodeId !== nodeId) })),
  removeSlow: (nodeId) => set((s) => ({ slowNodes: s.slowNodes.filter((f) => f.nodeId !== nodeId) })),
  clearFaults: () => set({ failNodes: [], slowNodes: [], crashAfterEffect: null }),
}));