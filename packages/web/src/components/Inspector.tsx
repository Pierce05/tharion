import { useState } from 'react';
import {
  DEFAULT_RETRY,
  describeType,
  inputPort,
  outputPort,
  type Json,
  type PortType,
  type RetryPolicy,
  type WorkflowNode,
  type NodeSample,
} from '@tharion/engine';
import { JsonView } from './JsonView';
import { PORT_COLORS, TYPE_META } from '../lib/nodeMeta';
import { useWorkflow } from '../store/workflow';

const PORT_TYPES: PortType[] = ['any', 'object', 'array', 'string', 'number', 'boolean'];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="fld">
      <span className="mic">{label}</span>
      {children}
    </label>
  );
}

function JsonField({ label, value, onValid }: { label: string; value: Json; onValid: (v: Json) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [ok, setOk] = useState(true);
  return (
    <Field label={label}>
      <textarea
        className="inp"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onValid(JSON.parse(e.target.value) as Json);
            setOk(true);
          } catch {
            setOk(false);
          }
        }}
      />
      <span className="m" style={{ fontSize: 11, color: ok ? 'var(--ok)' : 'var(--bad)' }}>{ok ? '● valid JSON' : '✕ invalid JSON (not applied)'}</span>
    </Field>
  );
}

function ConfigFields({ node, cfg }: { node: WorkflowNode; cfg: (patch: Record<string, unknown>) => void }) {
  switch (node.type) {
    case 'trigger':
      return (
        <>
          <Field label="kind">
            <select className="inp" value={node.config.kind} onChange={(e) => cfg({ kind: e.target.value })}>
              <option value="manual">manual</option>
              <option value="webhook">webhook</option>
            </select>
          </Field>
          <JsonField label="sample payload" value={node.config.samplePayload} onValid={(v) => cfg({ samplePayload: v })} />
        </>
      );
    case 'http':
      return (
        <>
          <Field label="method">
            <select className="inp" value={node.config.method} onChange={(e) => cfg({ method: e.target.value })}>
              {METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="url (template)"><input className="inp" value={node.config.url} onChange={(e) => cfg({ url: e.target.value })} /></Field>
          <Field label="body (template)">
            <textarea className="inp" value={node.config.body ?? ''} onChange={(e) => cfg({ body: e.target.value === '' ? undefined : e.target.value })} />
          </Field>
          <Field label="timeout ms">
            <input className="inp" type="number" min={1} value={node.config.timeoutMs} onChange={(e) => cfg({ timeoutMs: Number(e.target.value) || 1 })} />
          </Field>
        </>
      );
    case 'transform':
      return (
        <>
          <Field label="JSONata expression">
            <textarea className="inp" rows={5} value={node.config.expression} onChange={(e) => cfg({ expression: e.target.value })} />
          </Field>
          <Field label="declared output type">
            <select className="inp" value={node.config.outputType ?? 'any'} onChange={(e) => cfg({ outputType: e.target.value === 'any' ? undefined : e.target.value })}>
              {PORT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
        </>
      );
    case 'condition':
      return (
        <Field label="JSONata expression (boolean)">
          <textarea className="inp" rows={3} value={node.config.expression} onChange={(e) => cfg({ expression: e.target.value })} />
        </Field>
      );
    case 'delay':
      return (
        <Field label="delay ms">
          <input className="inp" type="number" min={0} value={node.config.ms} onChange={(e) => cfg({ ms: Math.max(0, Number(e.target.value) || 0) })} />
        </Field>
      );
    case 'notify':
      return (
        <>
          <Field label="channel"><input className="inp" value={node.config.channel} onChange={(e) => cfg({ channel: e.target.value })} /></Field>
          <Field label="template"><textarea className="inp" value={node.config.template} onChange={(e) => cfg({ template: e.target.value })} /></Field>
        </>
      );
    case 'output':
      return <Field label="label"><input className="inp" value={node.config.label} onChange={(e) => cfg({ label: e.target.value })} /></Field>;
  }
}

function Preview({ sample }: { sample?: NodeSample }) {
  if (!sample) return <p className="mic" style={{ marginTop: 12 }}>Preview computing…</p>;
  return (
    <>
      <p className="mic" style={{ marginTop: 14 }}>Live preview · sample data</p>
      <div className="pv">
        <div>
          <span className="mic">input</span>
          {sample.input !== undefined ? <JsonView value={sample.input} /> : <pre>unknown upstream</pre>}
        </div>
        <div>
          <span className="mic">output</span>
          {sample.error ? <pre className="err">{sample.error}</pre> : sample.output !== undefined ? <JsonView value={sample.output} /> : <pre>—</pre>}
        </div>
      </div>
      {sample.rendered && (<><span className="mic">rendered</span><pre>{sample.rendered}</pre></>)}
    </>
  );
}

function Body({ node, sample }: { node: WorkflowNode; sample?: NodeSample }) {
  const update = useWorkflow((s) => s.updateNode);
  const remove = useWorkflow((s) => s.removeNodes);
  const allIssues = useWorkflow((s) => s.issues);
  const issues = allIssues.filter((i) => i.nodeId === node.id);
  const meta = TYPE_META[node.type];
  const inP = inputPort(node);
  const outP = outputPort(node);
  const cfg = (patch: Record<string, unknown>): void =>
    update(node.id, (n) => ({ ...n, config: { ...n.config, ...patch } }) as WorkflowNode);
  const retry: RetryPolicy = node.retry ?? DEFAULT_RETRY;
  const setRetry = (patch: Partial<RetryPolicy>): void => update(node.id, (n) => ({ ...n, retry: { ...retry, ...patch } }));
  const canRetry = node.type !== 'trigger' && node.type !== 'output';

  return (
    <>
      <span className="mic">INSPECTOR</span>
      <div className="row" style={{ marginTop: 4 }}>
        <input className="inp lbl" aria-label="Node label" value={node.label} onChange={(e) => update(node.id, (n) => ({ ...n, label: e.target.value }))} />
        <span className="chip" style={{ color: meta.color }}>{node.type}</span>
      </div>
      <div className="m" style={{ color: 'var(--t2)', fontSize: 11 }}>id: {node.id}</div>

      <p className="mic" style={{ marginTop: 12 }}>Ports</p>
      <div className="row">
        {inP && <span className="chip" style={{ color: PORT_COLORS[inP.type] }}>in · {describeType(inP)}</span>}
        {node.type === 'condition' ? (
          <><span className="chip" style={{ color: '#3DDC97' }}>out · true</span><span className="chip" style={{ color: '#8A93A8' }}>out · false</span></>
        ) : (
          outP && <span className="chip" style={{ color: PORT_COLORS[outP.type] }}>out · {describeType(outP)}</span>
        )}
      </div>

      {issues.length > 0 && (
        <div style={{ marginTop: 10, color: 'var(--bad)', fontSize: 12 }}>
          {issues.map((i, k) => <div key={k}>{i.severity === 'error' ? '✕' : '△'} {i.message}</div>)}
        </div>
      )}

      <ConfigFields node={node} cfg={cfg} />

      {canRetry && (
        <>
          <p className="mic" style={{ marginTop: 14 }}>Retry policy</p>
          <div className="row">
            <input className="inp" style={{ width: 70 }} type="number" min={1} max={10} aria-label="Max attempts" value={retry.maxAttempts} onChange={(e) => setRetry({ maxAttempts: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })} />
            <select className="inp" style={{ width: 120 }} aria-label="Backoff" value={retry.backoff} onChange={(e) => setRetry({ backoff: e.target.value as RetryPolicy['backoff'] })}>
              <option value="fixed">fixed</option>
              <option value="exponential">exponential</option>
            </select>
            <input className="inp" style={{ width: 90 }} type="number" min={0} aria-label="Base ms" value={retry.baseMs} onChange={(e) => setRetry({ baseMs: Math.max(0, Number(e.target.value) || 0) })} />
            <span className="mic" style={{ letterSpacing: 0 }}>attempts · backoff · base ms</span>
          </div>
        </>
      )}

      <Preview sample={sample} />
      <button style={{ marginTop: 16, width: '100%', borderColor: 'var(--bad)', color: 'var(--bad)' }} onClick={() => remove([node.id])}>Delete node</button>
    </>
  );
}

export function Inspector() {
  const node = useWorkflow((s) => s.nodes.find((n) => n.id === s.selectedNodeId) ?? null);
  const sample = useWorkflow((s) => (s.selectedNodeId ? s.samples[s.selectedNodeId] : undefined));
  return (
    <aside className={`side${node ? ' open' : ''}`} aria-label="Node inspector">
      {node && <Body key={node.id} node={node} sample={sample} />}
    </aside>
  );
}