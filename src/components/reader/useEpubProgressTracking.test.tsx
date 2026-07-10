import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { useEpubProgressTracking } from './useEpubProgressTracking';

const location = {
  start: { cfi: 'epubcfi(/6/4)', index: 4, percentage: 0.62, sectionFraction: 0.38 },
  end: { cfi: 'epubcfi(/6/6)' },
};

function createRendition() {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  return {
    on: (event: string, listener: (value: unknown) => void) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    },
    off: (event: string, listener: (value: unknown) => void) => listeners.get(event)?.delete(listener),
    emit: (event: string, value: unknown) => listeners.get(event)?.forEach(listener => listener(value)),
    currentLocation: () => location,
    getContents: () => [],
  };
}

function Harness({
  rendition,
  updateBookProgress,
  setCurrentChapterLocation,
  setCurrentChapterSlice,
}: {
  rendition: ReturnType<typeof createRendition>;
  updateBookProgress: ReturnType<typeof vi.fn>;
  setCurrentChapterLocation: ReturnType<typeof vi.fn>;
  setCurrentChapterSlice: ReturnType<typeof vi.fn>;
}) {
  useEpubProgressTracking({
    rendition: rendition as unknown as ReaderRendition,
    bookId: 'book-1',
    updateBookProgress,
    setCurrentChapterSlice,
    setCurrentChapterLocation,
  });

  return null;
}

describe('useEpubProgressTracking', () => {
  it('records foliate reported progress immediately', async () => {
    const rendition = createRendition();
    const updateBookProgress = vi.fn();
    const setCurrentChapterLocation = vi.fn();
    const setCurrentChapterSlice = vi.fn();
    const container = document.createElement('div');
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <Harness
          rendition={rendition}
          updateBookProgress={updateBookProgress}
          setCurrentChapterLocation={setCurrentChapterLocation}
          setCurrentChapterSlice={setCurrentChapterSlice}
        />,
      );
    });

    expect(updateBookProgress).toHaveBeenCalledWith('book-1', {
      currentCfi: location.start.cfi,
      percentage: 62,
    });
    expect(setCurrentChapterLocation).toHaveBeenCalledWith({
      index: 4,
      title: 'Chapter 5',
      remainingPercent: 62,
    });

    flushSync(() => root.unmount());
  });

  it('skips chapter location writes when index, title, and remaining percent are unchanged', () => {
    const rendition = createRendition();
    const updateBookProgress = vi.fn();
    const setCurrentChapterLocation = vi.fn();
    const setCurrentChapterSlice = vi.fn();
    const container = document.createElement('div');
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <Harness
          rendition={rendition}
          updateBookProgress={updateBookProgress}
          setCurrentChapterLocation={setCurrentChapterLocation}
          setCurrentChapterSlice={setCurrentChapterSlice}
        />,
      );
    });

    // bookId effect clears location once; currentLocation() writes once more.
    const writesAfterMount = setCurrentChapterLocation.mock.calls.length;
    expect(writesAfterMount).toBeGreaterThanOrEqual(1);

    rendition.emit('locationChanged', {
      start: { cfi: 'epubcfi(/6/4!/4/2)', index: 4, percentage: 0.62, sectionFraction: 0.38, label: '' },
    });
    rendition.emit('locationChanged', {
      start: { cfi: 'epubcfi(/6/4!/4/8)', index: 4, percentage: 0.621, sectionFraction: 0.379, label: '' },
    });

    expect(setCurrentChapterLocation.mock.calls.length).toBe(writesAfterMount);

    rendition.emit('locationChanged', {
      start: { cfi: 'epubcfi(/6/4!/4/20)', index: 4, percentage: 0.7, sectionFraction: 0.3, label: '' },
    });

    expect(setCurrentChapterLocation).toHaveBeenLastCalledWith({
      index: 4,
      title: 'Chapter 5',
      remainingPercent: 70,
    });
    expect(setCurrentChapterLocation.mock.calls.length).toBe(writesAfterMount + 1);

    flushSync(() => root.unmount());
  });
});
