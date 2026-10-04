import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TEMPLATES, type OutboxRow } from '@tharion/engine';
import { api, type WorkflowSummary } from '../lib/api';
import { importWorkflowText, newBlank, newFromTemplate, openWorkflow } from '../lib/actions';
import { useCommands } from '../lib/commands';
import { errMsg } from '../lib/format';
import { useUi } from '../store/ui';

export function Toast() {
  const toast = useUi((s) => s.toast);
  return (
    <AnimatePresence>
      {toast && (
        <motion.div key={toast.id} className="toast glass" role="status" initial={{ y: 40, opacity: 0, x: '-50%' }} animate={{ y: 0, opacity: 1, x: '-50%' }} exit={{ y: 40, opacity: 0, x: '-50%' }}>
          {toast.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function CommandPalette() {
  const open = useUi((s) => s.cmdk);
  const setCmdk = useUi((s) => s.setCmdk);
  const commands = useCommands();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const list = useMemo(() => commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())), [commands, q]);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
    }
  }, [open]);

  const run = (i: number): void => {
    const c = list[i];
    if (!c) return;
    setCmdk(false);
    c.run();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="cmdk" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && setCmdk(false)} role="dialog" aria-label="Command palette">
          <motion.div className="glass" initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }}>
            <input
              autoFocus
              placeholder="Type a command…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setSel(0); }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setCmdk(false);
                else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
                else if (e.key === 'Enter') run(sel);
              }}
            />
            <ul style={{ padding: 6 }}>
              {list.map((c, i) => (
                <li key={c.id} className={i === sel ? 'a' : ''} onMouseEnter={() => setSel(i)} onClick={() => run(i)}>
                  {c.label}{c.hint && <small>{c.hint}</small>}
                </li>
              ))}
              {list.length === 0 && <li style={{ cursor: 'default' }}>No matching command</li>}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function WorkflowsBody() {
  const [items, setItems] = useState<WorkflowSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const openModal = useUi((s) => s.openModal);
  useEffect(() => {
    api.listWorkflows().then((r) => setItems(r.workflows)).catch((e: unknown) => setErr(errMsg(e)));
  }, []);
  return (
    <>
      <h2>Workflows</h2>
      {err && <p className="m" style={{ color: 'var(--bad)' }}>{err}</p>}
      {!items && !err && <div className="skel" />}
      {items?.length === 0 && <p className="mic" style={{ margin: '14px 0' }}>No workflows yet</p>}
      {items?.map((w) => (
        <button key={w.id} className="lrow" onClick={() => openWorkflow(w.id)}>
          <b className="sg">{w.name}</b><span className="chip">v{w.version}</span><span className="sp" />
          <span className="mic">{new Date(w.createdAt).toLocaleString()}</span>
        </button>
      ))}
      <div className="row" style={{ marginTop: 14 }}>
        <button onClick={() => void newBlank()}>New blank</button>
        <button onClick={() => openModal('templates')}>From template…</button>
        <button onClick={() => openModal('import')}>Import JSON…</button>
      </div>
    </>
  );
}

function TemplatesBody() {
  return (
    <>
      <h2>New from template</h2>
      <div className="tplgrid">
        {TEMPLATES.map((t) => (
          <button key={t.id} className="tplcard" onClick={() => void newFromTemplate(t.id)}>
            <b>{t.name}</b><span>{t.description}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function OutboxBody() {
  const [data, setData] = useState<{ rows: OutboxRow[]; count: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.outbox().then(setData).catch((e: unknown) => setErr(errMsg(e)));
  }, []);
  return (
    <>
      <h2>Outbox {data && <span className="chip">{data.count}</span>}</h2>
      {err && <p className="m" style={{ color: 'var(--bad)' }}>{err}</p>}
      {!data && !err && <div className="skel" />}
      {data?.rows.length === 0 && <p className="mic" style={{ margin: '14px 0' }}>No side effects delivered yet</p>}
      {data && data.rows.length > 0 && (
        <table>
          <thead><tr><th>id</th><th>run</th><th>node</th><th>channel</th><th>created</th><th>payload</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td><td>{r.runId}</td><td>{r.nodeId}</td><td>{r.channel}</td>
                <td>{new Date(r.createdAt).toLocaleTimeString()}</td><td>{JSON.stringify(r.payload)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function ImportBody() {
  const [text, setText] = useState('');
  return (
    <>
      <h2>Import workflow JSON</h2>
      <input type="file" accept="application/json,.json" style={{ margin: '12px 0' }} onChange={(e) => { void e.target.files?.[0]?.text().then(setText); }} />
      <textarea className="inp" rows={10} placeholder='{"name": "…", "nodes": [], "edges": []}' value={text} onChange={(e) => setText(e.target.value)} />
      <button style={{ marginTop: 10 }} disabled={!text.trim()} onClick={() => void importWorkflowText(text)}>Import</button>
    </>
  );
}

export function ModalHost() {
  const modal = useUi((s) => s.modal);
  const close = useUi((s) => s.closeModal);
  useEffect(() => {
    if (!modal) return;
    const h = (e: KeyboardEvent): void => { if (e.key === 'Escape') close();};
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [modal, close]);
  return (
    <AnimatePresence>
      {modal && (
        <motion.div key="ovl" className="ovl" role="dialog" aria-modal="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <motion.div className="glass mdl" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 14, opacity: 0 }}>
            {modal === 'workflows' && <WorkflowsBody />}
            {modal === 'templates' && <TemplatesBody />}
            {modal === 'outbox' && <OutboxBody />}
            {modal === 'import' && <ImportBody />}
            <button style={{ marginTop: 16 }} onClick={close}>Close</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}