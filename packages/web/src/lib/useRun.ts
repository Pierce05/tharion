import { useEffect, useState } from 'react';
import type { RunEvent } from '@tharion/engine';
import { api, type RunDetail } from './api';
import { errMsg } from './format';

/** Live event stream for a run (SSE). Dedupes by seq; EventSource reconnects with Last-Event-ID. */
export function useRunStream(runId: string | null): { events: RunEvent[]; ended: boolean; connected: boolean } {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [ended, setEnded] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setEvents([]);
    setEnded(false);
    setConnected(false);
    if (!runId) return;
    const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener('run-event', (m) => {
      const ev = JSON.parse((m as MessageEvent<string>).data) as RunEvent;
      setEvents((prev) => {
        const last = prev[prev.length - 1];
        return last && last.seq >= ev.seq ? prev : [...prev, ev];
      });
    });
    es.addEventListener('end', () => {
      setEnded(true);
      es.close();
    });
    return () => es.close();
  }, [runId]);

  return { events, ended, connected };
}

export function useRunDetail(runId: string, refreshKey: unknown): { detail: RunDetail | null; error: string | null } {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .getRun(runId)
      .then((d) => {
        if (alive) {
          setDetail(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(errMsg(e));
      });
    return () => {
      alive = false;
    };
  }, [runId, refreshKey]);
  return { detail, error };
}