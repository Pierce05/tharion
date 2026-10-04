import { useEffect, useState } from 'react';
import { api, type TestsResponse } from '../lib/api';
import { errMsg } from '../lib/format';
import { useSystem } from '../store/system';
import { useUi } from '../store/ui';

export function TestsView() {
  const [data, setData] = useState<TestsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const readOnly = useSystem((s) => s.sys?.readOnly === true);
  const toast = useUi((s) => s.showToast);

  useEffect(() => {
    let stop = false;
    const tick = async (): Promise<void> => {
      try {
        const r = await api.tests();
        if (!stop) {
          setData(r);
          setErr(null);
        }
      } catch (e) {
        if (!stop) setErr(errMsg(e));
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 1500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  const rep = data?.report ?? null;
  const run = (): void => {
    api.runTests().then(() => toast('Test run started (about 1–2 min)')).catch((e: unknown) => toast(errMsg(e)));
  };

  return (
    <div className="page">
      <div className="row">
        <span className="mic">ENGINE TESTS</span>
        <span className="sp" />
        <button disabled={readOnly || data?.running === true} title={readOnly ? 'Disabled in the read-only deployment' : undefined} onClick={run}>
          {data?.running ? 'Running…' : 'Run tests'}
        </button>
      </div>
      {err && <p className="m" style={{ color: 'var(--bad)' }}>{err}</p>}
      {!data && !err && <div className="skel" />}
      {data && !rep && (
        <div className="glass" style={{ padding: 24, marginTop: 16 }}>
          <h2>No test evidence yet</h2>
          <p className="m" style={{ color: 'var(--t1)', marginTop: 8 }}>Run <code>pnpm test:evidence</code> or press Run tests. Results are real vitest output.</p>
        </div>
      )}
      {rep && (
        <>
          <div className="sg bigcount" style={{ color: rep.failed > 0 ? 'var(--bad)' : 'var(--ok)' }}>
            {rep.passed}/{rep.total} {rep.failed > 0 ? 'FAILING' : 'PASS'}
          </div>
          <div className="mic">
            {rep.files.length} files{rep.skipped ? ` · ${rep.skipped} skipped` : ''}{rep.startTime ? ` · ran ${new Date(rep.startTime).toLocaleString()}` : ''}
          </div>
          <div style={{ marginTop: 18 }}>
            {rep.files.map((f) => {
              const bad = f.tests.filter((t) => t.status !== 'passed').length;
              return (
                <details key={f.file} className="glass tfile" open={bad > 0}>
                  <summary>
                    <span className="m">{f.file}</span>
                    <span className="chip" style={{ color: bad ? 'var(--bad)' : 'var(--ok)' }}>{f.tests.length - bad}/{f.tests.length}</span>
                  </summary>
                  {f.tests.map((t, i) => (
                    <div key={i} className="logrow" style={{ color: t.status === 'passed' ? 'var(--t1)' : 'var(--bad)' }}>
                      {t.status === 'passed' ? '✓' : '✕'} {t.name} <span style={{ color: 'var(--t2)' }}>{t.durationMs}ms</span>
                    </div>
                  ))}
                </details>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}