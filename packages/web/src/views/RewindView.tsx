import { navigate, useRoute } from '../lib/route';

export function RewindView() {
  const { id } = useRoute();
  return (
    <div className="cv">
      <div className="bloom" />
      <div className="state">
        <div className="glass">
          <span className="mic" style={{ color: 'var(--cyan)' }}>REWIND</span>
          <h2 style={{ marginTop: 6 }}>{id ? `Run ${id}` : 'No run selected'}</h2>
          <p>The scrubber, fork, diff and lineage tree land in Phase 5. The event log for this run is already recorded and replayable.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            {id && <button onClick={() => navigate('run', id)}>Open in Run view</button>}
            <button onClick={() => navigate('run')}>All runs</button>
          </div>
        </div>
      </div>
    </div>
  );
}