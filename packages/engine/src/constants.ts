import type { RetryPolicy } from './types';

export const LEASE_TTL_MS = 6000;
export const HEARTBEAT_MS = 2000;

export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  backoff: 'fixed',
  baseMs: 500,
};