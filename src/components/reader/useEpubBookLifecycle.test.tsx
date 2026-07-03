import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book as EpubBook, Rendition } from 'epubjs';
import type { Book, NavItem } from '../../types';
import type { EpubBookLike } from '../../services/reader/epubAdapter';
import type { ReadingEngineInstance } from '../../services/reader/readingEngine';
import { useEpubBookLifecycle } from './useEpubBookLifecycle';

const mocks = vi.hoisted(() => ({
  display: vi.fn(),
  loadLocations: vi.fn(),
  generateLocations: vi.fn(),
  readFile: vi.fn(),
  destroy: vi.fn(),
}));

// The lifecycle now drives everything through the engine adapters. Mock both
// adapters so the test exercises the lifecycle orchestration (preferred →
// fallback, gating of font sanitizer + locations) without a real reader.
const adapterMocks = vi.hoisted(() => ({
  foliateOpen: vi.fn(),
  epubjsOpen: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: mocks.readFile }));
vi.mock('../../services/reader/locationsCache', () => ({
  loadLocationsIfAvailable: mocks.loadLocations,
  generateAndPersistLocations: mocks.generateLocations,
}));
vi.mock('./epubFontSanitizer', () => ({ setupEpubFontSanitizer: () => () => {} }));
vi.mock('./epubTheme', () => ({ applyEpubTheme: vi.fn() }));
vi.mock('../../utils/perf', () => ({ perfSpan: (_name: string, fn: () => Promise<unknown>) => fn() }));
vi.mock('../../services/reader/foliateEngine', () => ({
  foliateEngineAdapter: { open: adapterMocks.foliateOpen },
}));
vi.mock('../../services/reader/epubjsEngine', () => ({
  epubjsEngineAdapter: { open: adapterMocks.epubjsOpen },
}));

const book: Book = {
  id: 'book-1',
  title: 'A Book',
  author: 'An Author',
  filePath: '/tmp/book.epub',
  addedAt: 1,
  progress: { currentCfi: '', percentage: 0 },
};

function epubjsInstance(): ReadingEngineInstance {
  const rendition = { display: mocks.display } as unknown as ReadingEngineInstance['rendition'];
  return {
    name: 'epubjs',
    rendition,
    bookLike: {} as EpubBookLike,
    toc: [] as NavItem[],
    locationsAvailable: false,
    destroy: mocks.destroy,
  };
}

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
    // By default foliate opens successfully and is the preferred engine.
    adapterMocks.foliateOpen.mockResolvedValue({
      name: 'foliate',
      rendition: { display: mocks.display },
      bookLike: {},
      toc: [],
      locationsAvailable: true,
      destroy: mocks.destroy,
    });
    adapterMocks.epubjsOpen.mockResolvedValue(epubjsInstance());
  });

  it('falls back to epubjs when foliate fails to open the book', async () => {
    adapterMocks.foliateOpen.mockRejectedValue(new Error('foliate boom'));

    mocks.display.mockResolvedValue(undefined);
    const onLocationsResolved = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => root.render(
      <Harness
        onLoadingChange={() => {}}
        onLocationsResolved={onLocationsResolved}
      />,
    ));
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    expect(adapterMocks.foliateOpen).toHaveBeenCalledOnce();
    expect(adapterMocks.epubjsOpen).toHaveBeenCalledOnce();
    // epubjs path defers locations; foliate would have resolved immediately.
    expect(mocks.display).toHaveBeenCalledOnce();

    flushSync(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('shows the first page before restoring cached locations (epubjs fallback)', async () => {
    adapterMocks.foliateOpen.mockRejectedValue(new Error('foliate boom'));

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

  it('resolves locations immediately for the foliate engine without generating them', async () => {
    mocks.display.mockResolvedValue(undefined);
    const onLocationsResolved = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => root.render(
      <Harness
        onLoadingChange={() => {}}
        onLocationsResolved={onLocationsResolved}
      />,
    ));
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    // foliate was preferred and succeeded, so epubjs is never tried.
    expect(adapterMocks.foliateOpen).toHaveBeenCalledOnce();
    expect(adapterMocks.epubjsOpen).not.toHaveBeenCalled();
    // foliate reports locationsAvailable: true → resolve immediately, no
    // generate path.
    expect(onLocationsResolved).toHaveBeenCalledWith(true);
    expect(mocks.loadLocations).not.toHaveBeenCalled();
    expect(mocks.generateLocations).not.toHaveBeenCalled();

    flushSync(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
});
