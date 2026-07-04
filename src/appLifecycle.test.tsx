import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  hydrateChatMessagesFromStorage,
  hydrateConversationMemoryFromStorage,
  importBookThroughLifecycle,
  migrateInlineCovers,
  useAppLifecyclePersistence,
  validateStartupBookPaths,
} from './appLifecycle';
import { STORAGE_KEYS } from './services/LocalStore';
import type { Book, ChatMessage, ConversationMemory, Library, Settings } from './types';
import type { BookProgressById } from './stores/app/initialState';

const roots: Root[] = [];

function mount(node: ReactElement): Root {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  flushSync(() => {
    root.render(node);
  });
  return root;
}

function book(overrides: Partial<Book> = {}): Book {
  return {
    id: 'book-1',
    title: 'Book',
    author: 'Author',
    filePath: '/books/book.epub',
    addedAt: 1,
    progress: { currentCfi: '', percentage: 0 },
    ...overrides,
  };
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    theme: 'light',
    fontSize: 16,
    fontFamily: 'Georgia',
    lineHeight: 1.6,
    readingMemoryAutoIngest: true,
    aiTextSize: 14,
    aiContextWindow: 20,
    aiAutoSummarize: true,
    ...overrides,
  };
}

function message(id: string): ChatMessage {
  return {
    id,
    role: 'user',
    content: id,
    timestamp: Number(id.replace(/\D/g, '')) || 1,
  };
}

function PersistenceHarness(params: {
  settings: Settings;
  library: Library;
  bookProgressById: BookProgressById;
}) {
  useAppLifecyclePersistence(params);
  return null;
}

describe('App Lifecycle contract', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    while (roots.length) {
      flushSync(() => roots.pop()!.unmount());
    }
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('hydrates startup chat from Dexie and preserves existing messages', async () => {
    const stored = [message('msg-1'), message('msg-2')];
    const hydrate = vi.fn();
    const replace = vi.fn();
    const removeLegacy = vi.fn();

    await hydrateChatMessagesFromStorage({
      loadChatMessages: vi.fn().mockResolvedValue(stored),
      replaceChatMessages: replace,
      removeLegacy,
      hydrateChatMessages: hydrate,
    });

    expect(hydrate).toHaveBeenCalledWith(stored);
    expect(replace).not.toHaveBeenCalled();
    expect(removeLegacy).not.toHaveBeenCalled();
  });

  it('migrates legacy localStorage chat once, trims it, and removes the legacy value', async () => {
    const legacy = Array.from({ length: 4 }, (_, index) => message(`msg-${index}`));
    const hydrate = vi.fn();
    const replace = vi.fn().mockResolvedValue(undefined);
    const removed: string[] = [];

    await hydrateChatMessagesFromStorage({
      loadChatMessages: vi.fn().mockResolvedValue([]),
      replaceChatMessages: replace,
      loadStored: vi.fn().mockReturnValue(legacy),
      removeLegacy: (key) => removed.push(key),
      hydrateChatMessages: hydrate,
      limit: 2,
    });

    expect(replace).toHaveBeenCalledWith(legacy.slice(-2), 2);
    expect(removed).toEqual([STORAGE_KEYS.chat]);
    expect(hydrate).toHaveBeenCalledWith(legacy.slice(-2));
  });

  it('hydrates Conversation Memory without adding a visible chat message', async () => {
    const memory: ConversationMemory = {
      id: 'memory-1',
      summary: 'Older turns summarized here',
      updatedAt: 1,
    };
    const hydrateMemory = vi.fn();
    const hydrateChat = vi.fn();

    await hydrateConversationMemoryFromStorage({
      loadConversationMemory: vi.fn().mockResolvedValue(memory),
      hydrateConversationMemory: hydrateMemory,
    });

    expect(hydrateMemory).toHaveBeenCalledWith(memory);
    expect(hydrateChat).not.toHaveBeenCalled();
  });

  it('persists settings, library, and progress through the lifecycle seam with skip-initial debounce', () => {
    vi.useFakeTimers();
    const libraryA: Library = { books: [], categories: [], lastUpdated: 1 };
    const progressA: BookProgressById = {};
    const root = mount(<PersistenceHarness settings={settings()} library={libraryA} bookProgressById={progressA} />);

    vi.advanceTimersByTime(900);
    expect(localStorage.getItem(STORAGE_KEYS.settings)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.library)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.progress)).toBeNull();

    const libraryB: Library = { books: [book()], categories: [], lastUpdated: 2 };
    const progressB: BookProgressById = { 'book-1': { currentCfi: 'epubcfi(/6/2)', percentage: 42, lastReadAt: 3 } };

    flushSync(() => {
      root.render(<PersistenceHarness settings={settings({ theme: 'dark' })} library={libraryB} bookProgressById={progressB} />);
    });

    vi.advanceTimersByTime(499);
    expect(localStorage.getItem(STORAGE_KEYS.settings)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) ?? 'null')).toMatchObject({ theme: 'dark' });

    vi.advanceTimersByTime(300);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.library) ?? 'null')).toMatchObject({ lastUpdated: 2 });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.progress) ?? 'null')).toMatchObject(progressB);
  });

  it('surfaces import failures as a notice and does not add a book', async () => {
    const addBook = vi.fn();
    const notice = vi.fn();

    const result = await importBookThroughLifecycle({
      filePath: '/bad/book.epub',
      books: [],
      addBook,
      updateBookSearchIndex: vi.fn(),
      notice,
      importBookFromPath: vi.fn().mockRejectedValue(new Error('Unreadable EPUB')),
    });

    expect(result).toBe('failed');
    expect(addBook).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith({
      title: '无法导入 EPUB',
      message: 'Unreadable EPUB',
    });
  });

  it('imports a new EPUB with pending Search Index state and applies quiet rebuild updates', async () => {
    const imported = book({ id: 'new-book', filePath: '/library/new.epub' });
    const added: Book[] = [];
    const searchUpdates: Array<{ id: string; state: string; error?: string }> = [];

    const result = await importBookThroughLifecycle({
      filePath: '/input/new.epub',
      books: [],
      addBook: (next) => added.push(next),
      updateBookSearchIndex: (id, summary) => searchUpdates.push({ id, ...summary }),
      importBookFromPath: vi.fn().mockResolvedValue({ status: 'imported', book: imported }),
      rebuildSearchIndexQuietly: vi.fn(async ({ onStatus }) => {
        onStatus?.({ state: 'ready', indexedAtMs: 123 });
      }),
    });

    await Promise.resolve();

    expect(result).toBe('imported');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ id: 'new-book', searchIndex: { state: 'pending' } });
    expect(searchUpdates).toEqual([{ id: 'new-book', state: 'ready', indexedAtMs: 123 }]);
  });

  it('skips importing an existing file path', async () => {
    const importBook = vi.fn();
    const result = await importBookThroughLifecycle({
      filePath: '/books/book.epub',
      books: [book()],
      addBook: vi.fn(),
      updateBookSearchIndex: vi.fn(),
      importBookFromPath: importBook,
    });

    expect(result).toBe('skipped');
    expect(importBook).not.toHaveBeenCalled();
  });

  it('migrates inline cover data URLs on the lifecycle path and respects cancellation', async () => {
    const library: Library = {
      books: [
        book({ id: 'cover-book', cover: 'data:image/png;base64,abc' }),
        book({ id: 'existing-cover', cover: 'data:image/png;base64,abc', coverKey: 'existing-cover' }),
      ],
      categories: [],
      lastUpdated: 1,
    };
    let nextLibrary = library;

    await migrateInlineCovers({
      library,
      dataUrlToBlob: vi.fn().mockResolvedValue(new Blob(['cover'])),
      saveCover: vi.fn().mockResolvedValue(undefined),
      applyLibrary: (updater) => {
        nextLibrary = updater(nextLibrary);
      },
      now: () => 2,
    });

    expect(nextLibrary.books[0]).toMatchObject({ id: 'cover-book', coverKey: 'cover-book' });
    expect(nextLibrary.books[0].cover).toBeUndefined();
    expect(nextLibrary.books[1]).toMatchObject({ id: 'existing-cover', coverKey: 'existing-cover' });
    expect(nextLibrary.lastUpdated).toBe(2);

    const cancelledApply = vi.fn();
    await migrateInlineCovers({
      library,
      dataUrlToBlob: vi.fn().mockResolvedValue(new Blob(['cover'])),
      saveCover: vi.fn().mockResolvedValue(undefined),
      applyLibrary: cancelledApply,
      isCancelled: () => true,
    });
    expect(cancelledApply).not.toHaveBeenCalled();
  });

  it('validates startup book paths once without clobbering a changed library', async () => {
    const initial: Library = { books: [book({ filePath: '/old.epub' })], categories: [], lastUpdated: 1 };
    const updated: Library = { books: [book({ filePath: '/fixed.epub' })], categories: [], lastUpdated: 2 };
    const setLibrary = vi.fn();

    await validateStartupBookPaths({
      getLibrary: vi.fn()
        .mockReturnValueOnce(initial)
        .mockReturnValueOnce({ ...initial, lastUpdated: 99 }),
      validateAndFixLibraryPaths: vi.fn().mockResolvedValue({
        updatedLibrary: updated,
        fixedBooks: ['book-1'],
        brokenBooks: [],
      }),
      setLibrary,
    });

    expect(setLibrary).not.toHaveBeenCalled();
  });

  it('updates the open current book when path validation fixes its file path', async () => {
    const current = book({ id: 'book-1', filePath: '/old.epub' });
    const initial: Library = { books: [current], categories: [], lastUpdated: 1 };
    const updatedBook = book({ id: 'book-1', filePath: '/fixed.epub' });
    const updated: Library = { books: [updatedBook], categories: [], lastUpdated: 2 };
    const setCurrentBook = vi.fn();
    const setLibrary = vi.fn();

    await validateStartupBookPaths({
      getLibrary: vi.fn().mockReturnValue(initial),
      getCurrentBook: vi.fn().mockReturnValue(current),
      validateAndFixLibraryPaths: vi.fn().mockResolvedValue({
        updatedLibrary: updated,
        fixedBooks: ['book-1'],
        brokenBooks: [],
      }),
      setLibrary,
      setCurrentBook,
    });

    expect(setLibrary).toHaveBeenCalledWith(updated);
    expect(setCurrentBook).toHaveBeenCalledWith({ ...current, filePath: '/fixed.epub' });
  });
});
