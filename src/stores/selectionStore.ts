import { create } from 'zustand';

/**
 * Transient reader selection state (issue #12).
 *
 * Holds the live text selection, its EPUB CFI range, and accumulated
 * cross-page snippets. None of this is persisted. `setSelectedText` preserves
 * the original rule: clearing the text also clears the CFI range.
 */
type SelectionState = {
  selectedText: string;
  setSelectedText: (text: string) => void;
  selectedCfiRange: string;
  setSelectedCfiRange: (cfiRange: string) => void;
  accumulatedTexts: string[];
  addToAccumulatedTexts: (text: string) => void;
  removeAccumulatedText: (index: number) => void;
  clearAccumulatedTexts: () => void;
  clearSelection: () => void;
};

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedText: '',
  setSelectedText: (text) =>
    set(text ? { selectedText: text } : { selectedText: '', selectedCfiRange: '' }),
  selectedCfiRange: '',
  setSelectedCfiRange: (cfiRange) => set({ selectedCfiRange: cfiRange }),
  accumulatedTexts: [],
  addToAccumulatedTexts: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    set((state) => ({ accumulatedTexts: [...state.accumulatedTexts, trimmed] }));
  },
  removeAccumulatedText: (index) =>
    set((state) => ({ accumulatedTexts: state.accumulatedTexts.filter((_, i) => i !== index) })),
  clearAccumulatedTexts: () => set({ accumulatedTexts: [] }),
  clearSelection: () => set({ selectedText: '', selectedCfiRange: '', accumulatedTexts: [] }),
}));
