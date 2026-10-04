import { useEffect } from 'react';
import { create } from 'zustand';
import { api, type SystemInfo } from '../lib/api';
import { errMsg } from '../lib/format';

interface SystemState {
  sys: SystemInfo | null;
  fetchedAt: number;
  error: string | null;
}

export const useSystem = create<SystemState>(() => ({ sys: null, fetchedAt: 0, error: null }));

export function useSystemPolling(ms = 500): void {
  useEffect(() => {
    let stop = false;
    const tick = async (): Promise<void> => {
      try {
        const sys = await api.system();
        if (!stop) useSystem.setState({ sys, fetchedAt: Date.now(), error: null });
      } catch (e) {
        if (!stop) useSystem.setState({ error: errMsg(e) });
      }
    };
    void tick();
    const t = setInterval(() => void tick(), ms);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [ms]);
}