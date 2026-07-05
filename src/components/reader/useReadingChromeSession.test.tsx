import { useRef } from 'react';
import { flushSync } from 'react-dom';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Book, NavItem } from '../../types';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { useAIStore } from '../../stores/aiStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { useProgressStore } from '../../stores/progressStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUIStore } from '../../stores/uiStore';
import { mount } from '../testUtils';
import { useReadingChromeSession } from './useReadingChromeSession';

const hookMocks = vi.hoisted(() => ({
  progressParams: null as null | Record<string, unknown>,
  selectionParams: null as null | Record<string, unknown>,
  search: {
    searchQuery: '',
    setSearchQuery: vi.fn(),
    searchResults: [] as Array<{ cfi: string; excerpt: string; section?: string }>,
    isSearching: false,
    isRebuildingIndex: false,
    searchError: null as string | null,
    refreshIndexStatus: vi.fn(() => Promise.resolve(null)),
    handleSearch: vi.fn(),
    rebuildCurrentIndex: vi.fn(),
    cancelSearch: vi.fn(),
    handleSearchResultClick: vi.fn(),
    setSearchResults: vi.fn(),
  },
}));

vi.mock('./useEpubProgressTracking', () => ({
  useEpubProgressTracking: (params: Record<string, unknown>) => {
    hookMocks.progressParams = params;
  },
}));

vi.mock('./useEpubSelectionTracking', () => ({
  useEpubSelectionTracking: (params: Record<string, unknown>) => {
    hookMocks.selectionParams = params;
  },
}));

vi.mock('./useEpubSearch', () => ({
  useEpubSearch: () => hookMocks.search,
}));

const book: Book = {
  id: 'book-1',
  title: 'A Book',
  author: 'An Author',
  filePath: '/tmp/book.epub',
  addedAt: 1,
  progress: { currentCfi: '', percentage: 0 },
  searchIndex: { state: 'missing' },
};

const toc: NavItem[] = [
  { id: 'chapter-1', href: 'chapter1.xhtml', label: 'Chapter 1' },
  { id: 'chapter-2', href: 'chapter2.xhtml', label: 'Chapter 2' },
];

function createRendition() {
  const listeners = new Map<string, Set<() => void>>();
  const rendition = {
    themes: { default: vi.fn() },
    display: vi.fn(),
    prev: vi.fn(),
    next: vi.fn(),
    currentLocation: vi.fn(() => ({ start: { href: 'chapter1.xhtml#p2', cfi: 'epubcfi(/6/4)' } })),
    on: vi.fn((event: string, listener: () => void) => {
      const bucket = listeners.get(event) ?? new Set();
      bucket.add(listener);
      listeners.set(event, bucket);
    }),
    off: vi.fn((event: string, listener: () => void) => listeners.get(event)?.delete(listener)),
    emit: (event: string) => listeners.get(event)?.forEach(listener => listener()),
  };
  return rendition as unknown as ReaderRendition & { emit: (event: string) => void };
}

type Session = ReturnType<typeof useReadingChromeSession>;

function Harness({
  rendition,
  currentBook = book,
  onSession,
}: {
  rendition: ReaderRendition;
  currentBook?: Book;
  onSession: (session: Session) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<ReaderRendition | null>(rendition);
  const session = useReadingChromeSession({
    currentBook,
    renditionRef,
    renditionKey: 1,
  });
  onSession(session);
  return <div ref={containerRef} />;
}

function mountSession(rendition = createRendition(), currentBook = book) {
  let session!: Session;
  mount(<Harness rendition={rendition} currentBook={currentBook} onSession={(next) => { session = next; }} />);
  return { session: () => session, rendition };
}

describe('useReadingChromeSession', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    hookMocks.progressParams = null;
    hookMocks.selectionParams = null;
    hookMocks.search.searchQuery = '';
    hookMocks.search.searchResults = [];
    hookMocks.search.searchError = null;
    useLibraryStore.setState({
      library: { books: [book], folders: [], lastUpdated: 0 },
      currentBook: book,
    });
    useUIStore.setState({ isSidebarOpen: true, isAIPanelOpen: false, isSearchOpen: false });
    useAIStore.setState({ currentChapterContent: '', chatMessages: [], conversationMemory: null });
    useSelectionStore.setState({ selectedText: '', selectedCfiRange: '', accumulatedTexts: [] });
    useProgressStore.setState({ bookProgressById: {} });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.resolve()) },
    });
  });

  it('routes TOC state and navigation through the session', () => {
    const { session, rendition } = mountSession();

    flushSync(() => {
      session().setToc(toc);
    });

    expect(session().isTocItemCurrent('chapter1.xhtml')).toBe(true);

    flushSync(() => {
      session().handleTocClick('chapter2.xhtml');
    });

    expect(rendition.display).toHaveBeenCalledWith('chapter2.xhtml');
    expect(session().showToc).toBe(false);
  });

  it('keeps search index status visible and actionable through the session', () => {
    const staleBook: Book = {
      ...book,
      searchIndex: {
        state: 'stale',
        error: 'old index',
      },
    };

    const { session } = mountSession(createRendition(), staleBook);

    expect(session().search.indexState).toBe('stale');
    expect(session().search.indexNeedsRebuild).toBe(true);
    expect(session().search.statusText).toBe('书籍文件已变化，需要重建搜索索引。');

    flushSync(() => {
      session().search.rebuildCurrentIndex();
    });

    expect(hookMocks.search.rebuildCurrentIndex).toHaveBeenCalledOnce();
  });

  it('routes coordinate-based selection add, ask, close, and hint state through the session', () => {
    const { session } = mountSession();
    const selectionParams = hookMocks.selectionParams as {
      setSelectedText: (text: string) => void;
      setSelectedCfiRange: (cfiRange: string) => void;
      setSelectionToolbarPos: (pos: { x: number; y: number }) => void;
      setShowSelectionToolbar: (show: boolean) => void;
      setShowSelectionHint: (show: boolean) => void;
    };

    flushSync(() => {
      selectionParams.setSelectedText(' selected quote ');
      selectionParams.setSelectedCfiRange('epubcfi(/6/4)');
      selectionParams.setSelectionToolbarPos({ x: 100, y: 200 });
      selectionParams.setShowSelectionToolbar(true);
      selectionParams.setShowSelectionHint(true);
    });

    expect(session().selectionToolbar.position).toEqual({ x: 100, y: 200 });
    expect(session().selectionToolbar.visible).toBe(true);
    expect(session().selectionToolbar.showHint).toBe(true);

    flushSync(() => {
      session().selectionToolbar.onAdd();
    });
    expect(useSelectionStore.getState().accumulatedTexts).toEqual(['selected quote']);

    flushSync(() => {
      session().selectionToolbar.onAsk();
    });
    expect(useUIStore.getState().isAIPanelOpen).toBe(true);
    expect(session().selectionToolbar.visible).toBe(false);

    flushSync(() => {
      selectionParams.setShowSelectionToolbar(true);
      session().selectionToolbar.onClose();
    });
    expect(useSelectionStore.getState().selectedText).toBe('');
    expect(useSelectionStore.getState().selectedCfiRange).toBe('');
    expect(session().selectionToolbar.position).toBeNull();
  });

  it('passes progress and chapter extraction routing into the progress tracker', () => {
    mountSession();

    const progressParams = hookMocks.progressParams as {
      bookId: string;
      updateBookProgress: (id: string, update: { currentCfi: string; percentage: number }) => void;
      setCurrentChapterContent: (content: string) => void;
    };

    flushSync(() => {
      progressParams.updateBookProgress('book-1', {
        currentCfi: 'epubcfi(/6/8)',
        percentage: 44,
      });
      progressParams.setCurrentChapterContent('fresh chapter body');
    });

    expect(progressParams.bookId).toBe('book-1');
    expect(useProgressStore.getState().bookProgressById['book-1'].percentage).toBe(44);
    expect(useAIStore.getState().currentChapterContent).toBe('fresh chapter body');
  });
});
