import { TEMPLATES } from '@tharion/engine';
import { newBlank, newFromTemplate } from '../lib/actions';

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="state" role="status">
      <div>
        <div className="skel" /><div className="skel" style={{ width: 180 }} />
        <p className="mic" style={{ textAlign: 'center' }}>{text}</p>
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state" role="alert">
      <div className="glass">
        <h2 style={{ color: 'var(--bad)' }}>Something went wrong</h2>
        <p className="m">{message}</p>
        {onRetry && <button onClick={onRetry}>Retry</button>}
      </div>
    </div>
  );
}

export function NoWorkflows() {
  return (
    <div className="state">
      <div className="glass">
        <h2>No workflows yet</h2>
        <p>Start from a template, or build from a blank canvas.</p>
        <div className="tplgrid">
          {TEMPLATES.map((t) => (
            <button key={t.id} className="tplcard" onClick={() => void newFromTemplate(t.id)}>
              <b>{t.name}</b>
              <span>{t.description}</span>
            </button>
          ))}
        </div>
        <button style={{ marginTop: 14 }} onClick={() => void newBlank()}>Blank canvas</button>
      </div>
    </div>
  );
}