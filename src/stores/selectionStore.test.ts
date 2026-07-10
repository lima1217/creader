import { beforeEach, describe, expect, it } from 'vitest';
import { useSelectionStore } from './selectionStore';

/**
 * Transient selection store (issue #12): selected text, CFI range, accumulated
 * snippets. Not persisted.
 */
describe('selectionStore', () => {
  beforeEach(() => {
    useSelectionStore.setState({ selectedText: '', selectedCfiRange: '', accumulatedTexts: [] });
  });

  it('clears the CFI range when text is cleared', () => {
    useSelectionStore.getState().setSelectedText('a highlight');
    useSelectionStore.getState().setSelectedCfiRange('epubcfi(/6/2!/4)');
    expect(useSelectionStore.getState().selectedCfiRange).toBe('epubcfi(/6/2!/4)');

    useSelectionStore.getState().setSelectedText('');
    expect(useSelectionStore.getState().selectedText).toBe('');
    expect(useSelectionStore.getState().selectedCfiRange).toBe('');
  });

  it('accumulates trimmed, non-empty snippets', () => {
    const { addToAccumulatedTexts } = useSelectionStore.getState();
    addToAccumulatedTexts('  first  ');
    addToAccumulatedTexts('');
    addToAccumulatedTexts('   ');
    addToAccumulatedTexts('second');

    expect(useSelectionStore.getState().accumulatedTexts).toEqual(['first', 'second']);
  });

  it('removes one snippet by index and clears all', () => {
    const store = useSelectionStore.getState();
    store.addToAccumulatedTexts('a');
    store.addToAccumulatedTexts('b');
    store.addToAccumulatedTexts('c');

    useSelectionStore.getState().removeAccumulatedText(1);
    expect(useSelectionStore.getState().accumulatedTexts).toEqual(['a', 'c']);

    useSelectionStore.getState().clearAccumulatedTexts();
    expect(useSelectionStore.getState().accumulatedTexts).toEqual([]);
  });

  it('clearSelection resets text, CFI, and accumulated quotes together', () => {
    const store = useSelectionStore.getState();
    store.setSelectedText('quote');
    store.setSelectedCfiRange('epubcfi(/6/2!/4)');
    store.addToAccumulatedTexts('earlier');

    useSelectionStore.getState().clearSelection();

    expect(useSelectionStore.getState()).toMatchObject({
      selectedText: '',
      selectedCfiRange: '',
      accumulatedTexts: [],
    });
  });
});
