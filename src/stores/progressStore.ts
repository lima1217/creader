import { create } from 'zustand';
import type { BookProgressUpdate, ReadingProgress } from '../types';
import { BookProgressById, getInitialBookProgressById } from './app/initialState';
import { markUserEditedPref, shouldSkipPrefHydrate } from '../services/appPrefsHydration';

/**
 * Reading progress map (issue #13), persisted via debounced Dexie writes.
 *
 * `updateBookProgress` is the public mutator (driven by page-turn events).
 * `setEntry` / `removeEntry` are internal seams used by the library store to
 * keep the progress map in step with add/remove/open-book side effects — the
 * same coupling the original `ProgressContext` + `LibraryContext` shared when
 * both lived inside one `AppProvider`.
 */
type ProgressState = {
  bookProgressById: BookProgressById;
  updateBookProgress: (id: string, update: BookProgressUpdate) => void;
  /** Replace the entry for one book. Internal — used by the library store. */
  setEntry: (id: string, entry: ReadingProgress & { lastReadAt: number }) => void;
  /** Remove the entry for one book. Internal — used by the library store. */
  removeEntry: (id: string) => void;
  /** Bulk replace — used by the bootstrap layer / tests. */
  replaceAll: (next: BookProgressById) => void;
};

export const useProgressStore = create<ProgressState>((set) => ({
  bookProgressById: getInitialBookProgressById(),
  updateBookProgress: (id, update) => {
    markUserEditedPref('progress');
    const lastReadAt = Date.now();
    const progress: ReadingProgress = {
      currentCfi: update.currentCfi,
      percentage: update.percentage,
    };
    set((state) => ({
      bookProgressById: {
        ...state.bookProgressById,
        [id]: { ...progress, lastReadAt },
      },
    }));
  },
  setEntry: (id, entry) => {
    markUserEditedPref('progress');
    set((state) => ({
      bookProgressById: { ...state.bookProgressById, [id]: entry },
    }));
  },
  removeEntry: (id) => {
    markUserEditedPref('progress');
    set((state) => {
      if (!(id in state.bookProgressById)) return state;
      const next = { ...state.bookProgressById };
      delete next[id];
      return { bookProgressById: next };
    });
  },
  replaceAll: (next) => set({ bookProgressById: next }),
}));

/** Seed progress from Dexie at startup (no extra write). */
export function hydrateProgress(bookProgressById: BookProgressById): void {
  if (shouldSkipPrefHydrate('progress')) return;
  useProgressStore.getState().replaceAll(bookProgressById);
}
