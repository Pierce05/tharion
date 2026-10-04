import { useEffect } from 'react';
import { Rail, TopBar } from './components/Chrome';
import { CommandPalette, ModalHost, Toast } from './components/Overlays';
import { goMode, saveWorkflow } from './lib/actions';
import { useRoute } from './lib/route';
import { useSystemPolling } from './store/system';
import { useUi } from './store/ui';
import { BuildView } from './views/BuildView';
import { RewindView } from './views/RewindView';
import { RunView } from './views/RunView';

function useGlobalKeys(): void {
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      const ui = useUi.getState();
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.setCmdk(!ui.cmdk);
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveWorkflow();
        return;
      }
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable || ui.cmdk || ui.modal) return;
      if (e.key === '1') goMode('build');
      else if (e.key === '2') goMode('run');
      else if (e.key === '3') goMode('rewind');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
}

export function App() {
  const { mode } = useRoute();
  useSystemPolling(500);
  useGlobalKeys();
  useEffect(() => {
    document.body.dataset.mode = mode;
  }, [mode]);

  return (
    <div className="app">
      <TopBar />
      <Rail />
      <main className="main">
        {mode === 'build' && <BuildView />}
        {mode === 'run' && <RunView />}
        {mode === 'rewind' && <RewindView />}
      </main>
      <CommandPalette />
      <ModalHost />
      <Toast />
    </div>
  );
}