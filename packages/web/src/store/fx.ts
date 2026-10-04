import { create } from 'zustand';

/** Timestamp of the last successful fork; the Rewind view plays the branch-split animation when it is recent. */
export const useFx = create<{ forkAt: number }>(() => ({ forkAt: 0 }));
export const markFork = (): void => useFx.setState({ forkAt: Date.now() });