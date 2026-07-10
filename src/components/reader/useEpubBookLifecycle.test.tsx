import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book, NavItem } from '../../types';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import type { ReadingEngineInstance } from '../../services/reader/readingEngine';
import { DEFAULT_READING_LAYOUT } from '../../services/reader/readingEngine';
import { useSelectionStore } from '../../stores/selectionStore';
import { useEpubBookLifecycle } from './useEpubBookLifecycle';

const mocks = vi.hoisted(() => ({
  display: vi.fn(),
  setLayout: vi.fn(),
  readFile: vi.fn(),
  destroy: vi.fn(),
}));

const adapterMocks = vi.hoisted(() => ({
  foliateOpen: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: mocks.readFile }));
vi.mock('./epubTheme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./epubTheme')>();
  return { ...actual, applyEpubTheme: vi.fn() };
});
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

const bookB: Book = {
  id: 'book-2',
  title: 'B Book',
  author: 'B Author',
  filePath: '/tmp/book-b.epub',
  addedAt: 2,
  progress: { currentCfi: '', percentage: 0 },
};

function foliateInstance(): ReadingEngineInstance {
  const rendition = {
    display: mocks.display,
    prev: vi.fn(),
    next: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    setLayout: mocks.setLayout,
    themes: { default: vi.fn() },
  } as unknown as ReadingEngineInstance['rendition'];
  return {
    name: 'foliate',
    rendition,
    toc: [] as NavItem[],
    destroy: mocks.destroy,
  };
}

function Harness({
  currentBook = book,
  onLoadingChange,
  onError,
  onFileNotFound,
  onEngineLoadError,
}: {
  currentBook?: Book;
  onLoadingChange: (loading: boolean) => void;
  onError?: (error: string | null) => void;
  onFileNotFound?: (isNotFound: boolean) => void;
  onEngineLoadError?: (isEngineLoadError: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<ReaderRendition | null>(null);
  const [, setLoading] = useState(false);

  useEpubBookLifecycle({
    currentBook,
    containerRef,
    settings: {
      theme: 'light',
      fontSize: 16,
      readingMemoryAutoIngest: false,
      aiTextSize: 14,
      aiContextWindow: 20,
      aiToolRounds: 8,
      aiAutoSummarize: false,
      aiThinkingEnabled: false,
    },
    renditionRef,
    setToc: () => {},
    setIsLoading: (loading) => {
      setLoading(loading);
      onLoadingChange(loading);
    },
    setError: onError ?? (() => {}),
    setIsFileNotFound: onFileNotFound ?? (() => {}),
    setIsEngineLoadError: onEngineLoadError ?? (() => {}),
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
    useSelectionStore.setState({ selectedText: '', selectedCfiRange: '', accumulatedTexts: [] });
  });

  it('surfaces an engine-load message when foliate cannot be imported', async () => {
    adapterMocks.foliateOpen.mockRejectedValue(
      new Error('Failed to fetch dynamically imported module: foliate-js/view.js'),
    );

    const onError = vi.fn();
    const onEngineLoadError = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => root.render(
      <Harness
        onLoadingChange={() => {}}
        onError={onError}
        onEngineLoadError={onEngineLoadError}
      />,
    ));
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    expect(onEngineLoadError).toHaveBeenLastCalledWith(true);
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('无法加载阅读引擎'));

    flushSync(() => root.unmount());
    container.remove();
    vi.useRealTimers();
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

  it('surfaces missing files as a recoverable file-not-found state', async () => {
    mocks.readFile.mockRejectedValue(new Error('No such file or directory'));

    const onError = vi.fn();
    const onFileNotFound = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => root.render(
      <Harness
        onLoadingChange={() => {}}
        onError={onError}
        onFileNotFound={onFileNotFound}
      />,
    ));
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    expect(onFileNotFound).toHaveBeenCalledWith(false);
    expect(onFileNotFound).toHaveBeenLastCalledWith(true);
    expect(onError).toHaveBeenLastCalledWith('找不到文件。它可能已被移动、重命名或删除。');
    expect(adapterMocks.foliateOpen).not.toHaveBeenCalled();

    flushSync(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('clears loading only after the first display resolves', async () => {
    let finishDisplay!: () => void;
    mocks.display.mockImplementation(() => new Promise<void>((resolve) => {
      finishDisplay = resolve;
    }));
    const loadingStates: boolean[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => root.render(
      <Harness
        onLoadingChange={(loading) => loadingStates.push(loading)}
      />,
    ));
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    expect(mocks.display).toHaveBeenCalledOnce();
    expect(loadingStates[loadingStates.length - 1]).toBe(true);

    finishDisplay();
    await settle();

    expect(loadingStates[loadingStates.length - 1]).toBe(false);

    flushSync(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('opens only the foliate engine', async () => {
    mocks.display.mockResolvedValue(undefined);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => root.render(
      <Harness
        onLoadingChange={() => {}}
      />,
    ));
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    expect(adapterMocks.foliateOpen).toHaveBeenCalledOnce();

    flushSync(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('pins flow=scrolled before the first display so the first paint is already scrolled (#88)', async () => {
    mocks.display.mockResolvedValue(undefined);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => root.render(
      <Harness onLoadingChange={() => {}} />,
    ));
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    expect(mocks.setLayout).toHaveBeenCalledWith({
      flow: 'scrolled',
      maxInlineSize: DEFAULT_READING_LAYOUT.maxInlineSize,
      animated: true,
    });
    expect(mocks.setLayout).toHaveBeenCalledBefore(mocks.display);

    flushSync(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('enables scrolled layout with animated page turns before first display', async () => {
    mocks.display.mockResolvedValue(undefined);
    const instance = foliateInstance();
    adapterMocks.foliateOpen.mockResolvedValue(instance);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => root.render(
      <Harness onLoadingChange={() => {}} />,
    ));
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    expect(instance.rendition.setLayout).toHaveBeenCalledWith({
      flow: 'scrolled',
      maxInlineSize: DEFAULT_READING_LAYOUT.maxInlineSize,
      animated: true,
    });
    expect(mocks.display).toHaveBeenCalledOnce();

    flushSync(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('clears selection state when opening a book', async () => {
    useSelectionStore.setState({
      selectedText: 'stale quote',
      selectedCfiRange: 'epubcfi(/6/2!/4)',
      accumulatedTexts: ['old'],
    });
    mocks.display.mockResolvedValue(undefined);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => root.render(<Harness onLoadingChange={() => {}} />));
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    expect(useSelectionStore.getState()).toMatchObject({
      selectedText: '',
      selectedCfiRange: '',
      accumulatedTexts: [],
    });

    flushSync(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('ignores a slow book A finish after book B has started loading', async () => {
    const pendingDisplays: Array<() => void> = [];
    mocks.display.mockImplementation(() => new Promise<void>((resolve) => {
      pendingDisplays.push(resolve);
    }));

    const loadingStates: boolean[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => root.render(
      <Harness
        currentBook={book}
        onLoadingChange={(loading) => loadingStates.push(loading)}
      />,
    ));
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(pendingDisplays).toHaveLength(1);
    expect(loadingStates[loadingStates.length - 1]).toBe(true);

    flushSync(() => root.render(
      <Harness
        currentBook={bookB}
        onLoadingChange={(loading) => loadingStates.push(loading)}
      />,
    ));
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(pendingDisplays).toHaveLength(2);
    expect(loadingStates[loadingStates.length - 1]).toBe(true);

    // Book A's late display resolve must not clear book B's loading state.
    pendingDisplays[0]();
    await settle();
    expect(loadingStates[loadingStates.length - 1]).toBe(true);

    pendingDisplays[1]();
    await settle();
    expect(loadingStates[loadingStates.length - 1]).toBe(false);

    flushSync(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
});
