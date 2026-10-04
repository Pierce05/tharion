const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Escapes first, then wraps JSON tokens. Safe to use with dangerouslySetInnerHTML. */
export function highlightJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  if (text === undefined) return 'undefined';
  return esc(text).replace(
    /("(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (m) => {
      let cls = 'n';
      if (m.startsWith('"')) cls = m.endsWith(':') ? 'k' : 's';
      return `<span class="${cls}">${m}</span>`;
    },
  );
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);