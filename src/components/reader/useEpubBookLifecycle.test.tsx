import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book as EpubBook, Rendition } from 'epubjs';
import type { Book } from '../../types';
import type { EpubBookLike } from '../../services/reader/epubAdapter';
import { useEpubBookLifecycle } from './useEpubBookLifecycle';

const mocks = vi.hoisted(() => ({
  display: vi.fn(),
  loadLocations: vi.fn(),
  generateLocations: vi.fn(),
  readFile: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: mocks.readFile }));
vi.mock('../../services/reader/locationsCache', () => ({
  loadLocationsIfAvailable: mocks.loadLocations,
  generateAndPersistLocations: mocks.generateLocations,
}));
vi.mock('./epubFontSanitizer', () => ({ setupEpubFontSanitizer: () => () => {} }));
vi.mock('./epubTheme', () => ({ applyEpubTheme: vi.fn() }));
vi.mock('../../utils/perf', () => ({ perfSpan: (_name: string, fn: () => Promise<unknown>) => fn() }));
vi.mock('epubjs', () => ({
  default: () => ({
    ready: Promise.resolve(),
    navigation: { toc: [] },
    locations: {},
    renderTo: () => ({ display: mocks.display }),
    destroy: mocks.destroy,
  }),
}));

const book: Book = {
  id: 'book-1',
  title: 'A Book',
  author: 'An Author',
  filePath: '/tmp/book.epub',
  addedAt: 1,
  progress: { currentCfi: '', percentage: 0 },
};

function Harness({
  onLoadingChange,
  onLocationsResolved,
}: {
  onLoadingChange: (loading: boolean) => void;
  onLocationsResolved?: (available: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const bookLikeRef = useRef<EpubBookLike | null>(null);
  const scriptsAllowedRef = useRef(false);
  const [, setLoading] = useState(false);

  useEpubBookLifecycle({
    currentBook: book,
    containerRef,
    settings: {
      theme: 'light',
      fontSize: 16,
      fontFamily: 'Georgia',
      lineHeight: 1.6,
      allowEpubScripts: false,
      readingMemoryAutoIngest: false,
      aiTextSize: 14,
      aiContextWindow: 20,
      aiAutoSummarize: false,
    },
    scriptsEnabled: false,
    epubScriptsAllowedRef: scriptsAllowedRef,
    bookRef,
    renditionRef,
    bookLikeRef,
    setToc: () => {},
    setIsLoading: (loading) => {
      setLoading(loading);
      onLoadingChange(loading);
    },
    setError: () => {},
    setIsFileNotFound: () => {},
    onLocationsResolved,
  });

  return <div ref={containerRef} />;
}

async function settle() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

describe('useEpubBookLifecycle opening critical path', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.loadLocations.mockResolvedValue(true);
  });

  it('shows the first page before restoring cached locations', async () => {
    let finishDisplay!: () => void;
    mocks.display.mockImplementation(() => new Promise<void>((resolve) => {
      finishDisplay = resolve;
    }));
    const loadingStates: boolean[] = [];
    const onLocationsResolved = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => root.render(
      <Harness
        onLoadingChange={(loading) => loadingStates.push(loading)}
        onLocationsResolved={onLocationsResolved}
      />,
    ));
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    expect(mocks.display).toHaveBeenCalledOnce();
    expect(mocks.loadLocations).not.toHaveBeenCalled();
    expect(loadingStates[loadingStates.length - 1]).toBe(true);

    finishDisplay();
    await settle();

    expect(loadingStates[loadingStates.length - 1]).toBe(false);
    expect(mocks.loadLocations).toHaveBeenCalledOnce();
    expect(onLocationsResolved).toHaveBeenCalledWith(true);

    flushSync(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
});
