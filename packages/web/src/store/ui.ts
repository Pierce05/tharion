import { create } from 'zustand';

export type ModalKind = 'workflows' | 'templates' | 'outbox' | 'import';

interface UiState {
  cmdk: boolean;
  modal: ModalKind | null;
  toast: { id: number; text: string } | null;
  lastRunId: string | null;
  flash: number;
  setCmdk: (v: boolean) => void;
  openModal: (m: ModalKind) => void;
  closeModal: () => void;
  showToast: (text: string) => void;
  setLastRun: (id: string) => void;
  fireFlash: () => void;
}

const RUN_KEY = 'tharion:run';
const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

export const useUi = create<UiState>((set) => ({
  cmdk: false,
  modal: null,
  toast: null,
  lastRunId: read(RUN_KEY),
  flash: 0,
  setCmdk: (cmdk) => set({ cmdk }),
  openModal: (modal) => set({ modal, cmdk: false }),
  closeModal: () => set({ modal: null }),
  showToast: (text) => {
    clearTimeout(timer);
    set({ toast: { id: ++seq, text } });
    timer = setTimeout(() => set({ toast: null }), 3400);
  },
  setLastRun: (id) => {
    try {
      localStorage.setItem(RUN_KEY, id);
    } catch {
      /* storage unavailable */
    }
    set({ lastRunId: id });
  },
  fireFlash: () => set((s) => ({ flash: s.flash + 1 })),
}));