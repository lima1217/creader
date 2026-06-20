import { useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Rendition } from 'epubjs';
import type { EpubBookLike } from '../../services/reader/epubAdapter';
import { useEpubProgressTracking } from './useEpubProgressTracking';

const location = {
  start: { cfi: 'epubcfi(/6/4)', index: 4, percentage: 0.62 },
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
  locationsStatus,
  updateBookProgress,
}: {
  rendition: ReturnType<typeof createRendition>;
  locationsStatus: 'pending' | 'ready' | 'unavailable';
  updateBookProgress: ReturnType<typeof vi.fn>;
}) {
  const renditionRef = useRef(rendition as unknown as Rendition);
  const bookLikeRef = useRef({
    locations: {
      length: () => locationsStatus === 'ready' ? 100 : 0,
      percentageFromCfi: () => 0.62,
    },
    spine: { length: 10 },
  } as unknown as EpubBookLike);

  useEpubProgressTracking({
    renditionRef,
    bookLikeRef,
    renditionKey: 1,
    bookId: 'book-1',
    locationsStatus,
    updateBookProgress,
    setCurrentChapterContent: () => {},
  });

  return null;
}

describe('useEpubProgressTracking', () => {
  it('does not overwrite saved progress before locations resolve, then refreshes it', async () => {
    const rendition = createRendition();
    const updateBookProgress = vi.fn();
    const container = document.createElement('div');
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <Harness
          rendition={rendition}
          locationsStatus="pending"
          updateBookProgress={updateBookProgress}
        />,
      );
    });

    rendition.emit('relocated', { ...location, start: { ...location.start, percentage: undefined } });
    expect(updateBookProgress).not.toHaveBeenCalled();

    flushSync(() => {
      root.render(
        <Harness
          rendition={rendition}
          locationsStatus="ready"
          updateBookProgress={updateBookProgress}
        />,
      );
    });

    expect(updateBookProgress).toHaveBeenCalledWith('book-1', {
      kind: 'epub',
      currentCfi: location.start.cfi,
      percentage: 62,
    });

    flushSync(() => root.unmount());
  });
});
