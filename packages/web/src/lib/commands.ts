import { useMemo } from 'react';
import {
  duplicateWorkflow,
  exportWorkflow,
  goMode,
  newBlank,
  saveWorkflow,
  startRun,
} from './actions';
import { useUi } from '../store/ui';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function useCommands(): Command[] {
  const openModal = useUi((s) => s.openModal);

  return useMemo(
    () => [
      { id: 'build', label: 'Switch to Build', hint: '1', run: () => goMode('build') },
      { id: 'run', label: 'Switch to Run', hint: '2', run: () => goMode('run') },
      { id: 'rewind', label: 'Switch to Rewind', hint: '3', run: () => goMode('rewind') },
      { id: 'start', label: 'Run workflow', run: () => void startRun() },
      { id: 'save', label: 'Save workflow (new version)', hint: '⌘S', run: () => void saveWorkflow() },
      { id: 'wfs', label: 'Open workflows…', run: () => openModal('workflows') },
      { id: 'tpl', label: 'New from template…', run: () => openModal('templates') },
      { id: 'blank', label: 'New blank workflow', run: () => void newBlank() },
      { id: 'dup', label: 'Duplicate workflow', run: () => void duplicateWorkflow() },
      { id: 'exp', label: 'Export workflow JSON', run: exportWorkflow },
      { id: 'imp', label: 'Import workflow JSON…', run: () => openModal('import') },
      { id: 'out', label: 'Show outbox', run: () => openModal('outbox') },
      { id: 'tests', label: 'Show engine tests', run: () => navigate('tests') },
    ],
    [openModal],
  );
}