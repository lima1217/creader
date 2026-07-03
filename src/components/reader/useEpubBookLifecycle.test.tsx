import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book, NavItem } from '../../types';
import type { EpubBookLike, ReaderRendition } from '../../services/reader/epubAdapter';
import type { ReadingEngineInstance } from '../../services/reader/readingEngine';
import { useEpubBookLifecycle } from './useEpubBookLifecycle';

const mocks = vi.hoisted(() => ({
  display: vi.fn(),
  readFile: vi.fn(),
  destroy: vi.fn(),
}));

const adapterMocks = vi.hoisted(() => ({
  foliateOpen: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: mocks.readFile }));
vi.mock('./epubTheme', () => ({ applyEpubTheme: vi.fn() }));
vi.mock('../../utils/perf', () => ({ perfSpan: (_name: string, fn: () => Promise<unknown>) => fn() }));
vi.mock('../../services/reader/foliateEngine', () => ({
  foliateEngineAdapter: { open: adapterMocks.foliateOpen },
}));

const book: Book = {
  id: 'book-1',
  title: 'A Book',
  author: 'An Author',
  filePath: '/tmp/book.epub',
  addedAt: 1,
  progress: { currentCfi: '', percentage: 0 },
};

function foliateInstance(): ReadingEngineInstance {
  const rendition = {
    display: mocks.display,
    prev: vi.fn(),
    next: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    themes: { default: vi.fn() },
  } as unknown as ReadingEngineInstance['rendition'];
  return {
    name: 'foliate',
    rendition,
    bookLike: {} as EpubBookLike,
    toc: [] as NavItem[],
    locationsAvailable: true,
    destroy: mocks.destroy,
  };
}

function Harness({
  onLoadingChange,
  onLocationsResolved,
  onError,
}: {
  onLoadingChange: (loading: boolean) => void;
  onLocationsResolved?: (available: boolean) => void;
  onError?: (error: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBookLike | null>(null);
  const renditionRef = useRef<ReaderRendition | null>(null);
  const bookLikeRef = useRef<EpubBookLike | null>(null);
  const [, setLoading] = useState(false);

  useEpubBookLifecycle({
    currentBook: book,
    containerRef,
    settings: {
      theme: 'light',
      fontSize: 16,
      fontFamily: 'Georgia',
      lineHeight: 1.6,
      readingMemoryAutoIngest: false,
      aiTextSize: 14,
      aiContextWindow: 20,
      aiAutoSummarize: false,
    },
    bookRef,
    renditionRef,
    bookLikeRef,
    setToc: () => {},
    setIsLoading: (loading) => {
      setLoading(loading);
      onLoadingChange(loading);
    },
    setError: onError ?? (() => {}),
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
    adapterMocks.foliateOpen.mockResolvedValue(foliateInstance());
  });

  it('surfaces an unsupported EPUB message when foliate fails to open the book', async () => {
    adapterMocks.foliateOpen.mockRejectedValue(new Error('foliate boom'));

    const onError = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => root.render(
      <Harness
        onLoadingChange={() => {}}
        onError={onError}
      />,
    ));
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    expect(adapterMocks.foliateOpen).toHaveBeenCalledOnce();
    expect(mocks.display).not.toHaveBeenCalled();
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('CReader 当前不支持'));

    flushSync(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('shows the first page before resolving foliate progress availability', async () => {
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
    expect(loadingStates[loadingStates.length - 1]).toBe(true);

    finishDisplay();
    await settle();

    expect(loadingStates[loadingStates.length - 1]).toBe(false);
    expect(onLocationsResolved).toHaveBeenCalledWith(true);

    flushSync(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('opens only the foliate engine', async () => {
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
    expect(onLocationsResolved).toHaveBeenCalledWith(true);

    flushSync(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
});
