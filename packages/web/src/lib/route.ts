import { useMemo, useSyncExternalStore } from 'react';

export type Mode = 'build' | 'run' | 'rewind' | 'tests';
export interface Route {
  mode: Mode;
  id: string | null;
}


function parse(hash: string): Route {
  const m = RE.exec(hash);
  if (!m) return { mode: 'build', id: null };
  return { mode: m[1] as Mode, id: m[2] ? decodeURIComponent(m[2]) : null };
}

const RE = /^#\/(build|run|rewind|tests)(?:\/([^/?#]+))?/;

const subscribe = (cb: () => void): (() => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '');
  return useMemo(() => parse(hash), [hash]);
}

export function navigate(mode: Mode, id?: string | null, replace = false): void {
  const h = `#/${mode}${id ? '/' + encodeURIComponent(id) : ''}`;
  if (replace) window.location.replace(h);
  else window.location.hash = h;
}