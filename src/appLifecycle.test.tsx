import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  hydrateChatMessagesFromStorage,
  hydrateConversationMemoryFromStorage,
  hydrateAppPrefsFromStorage,
  hydrateAppPrefsFromLocalStorage,
  importBookFileThroughLifecycle,
  importBookThroughLifecycle,
  migrateInlineCovers,
  openBookThroughLifecycle,
  prepareBookOpen,
  removeBookThroughLifecycle,
  useAppLifecyclePersistence,
  validateStartupBookPaths,
} from './appLifecycle';
import { STORAGE_KEYS } from './services/LocalStore';
import { APP_PREF_KEYS } from './services/DexieDb';
import { loadAppPref, saveAppPref } from './services/AppPrefsStore';
import { resetIndexedDb } from './services/indexedDbTestUtils';
import { markAppPrefsHydrated, markUserEditedPref } from './services/appPrefsHydration';
import type { Book, ChatMessage, ConversationMemory, Library, Settings } from './types';
import { DEFAULT_SETTINGS, type BookProgressById } from './stores/app/initialState';

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
  return { ...DEFAULT_SETTINGS, ...overrides };
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
  beforeEach(async () => {
    await resetIndexedDb();
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

  it('hydrates settings, library, progress, and quick actions from Dexie with legacy localStorage migration', async () => {
    const libraryA: Library = { books: [book()], folders: [], lastUpdated: 2 };
    const progressA: BookProgressById = {
      'book-1': { currentCfi: 'epubcfi(/6/2)', percentage: 42, lastReadAt: 3 },
    };
    const customQuickActions = [{ id: 'custom', label: 'Mine', prompt: 'Go' }];
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ v: 1, data: settings({ theme: 'dark' }) }));
    localStorage.setItem(STORAGE_KEYS.library, JSON.stringify({ v: 1, data: libraryA }));
    localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify({ v: 1, data: progressA }));
    localStorage.setItem(STORAGE_KEYS.quickActions, JSON.stringify({ v: 1, data: customQuickActions }));

    const applySettings = vi.fn();
    const applyLibrary = vi.fn();
    const applyProgress = vi.fn();
    const applyQuickActions = vi.fn();
    const removed: string[] = [];

    await hydrateAppPrefsFromStorage({
      hydrateSettings: applySettings,
      hydrateLibrary: applyLibrary,
      hydrateProgress: applyProgress,
      hydrateQuickActionConfigs: applyQuickActions,
      removeLegacy: (key) => removed.push(key),
    });

    expect(applySettings).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
    expect(applyLibrary).toHaveBeenCalledWith(libraryA);
    expect(applyProgress).toHaveBeenCalledWith(progressA);
    expect(applyQuickActions).toHaveBeenCalledWith(customQuickActions);
    expect(removed.sort()).toEqual([
      STORAGE_KEYS.library,
      STORAGE_KEYS.progress,
      STORAGE_KEYS.quickActions,
      STORAGE_KEYS.settings,
    ]);
  });

  it('does not overwrite settings edited before hydration completes', async () => {
    localStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({ v: 1, data: settings({ theme: 'dark' }) }),
    );

    const { useSettingsStore } = await import('./stores/settingsStore');

    useSettingsStore.getState().setSettings(settings({ theme: 'light', fontSize: 20 }));

    await hydrateAppPrefsFromStorage({
      hydrateLibrary: vi.fn(),
      hydrateProgress: vi.fn(),
      hydrateQuickActionConfigs: vi.fn(),
      hydrateExpandedFolderIds: vi.fn(),
    });

    expect(useSettingsStore.getState().settings).toMatchObject({ theme: 'light', fontSize: 20 });
  });

  it('does not overwrite library edited before hydration completes', async () => {
    const storedLibrary: Library = { books: [book()], folders: [], lastUpdated: 2 };
    localStorage.setItem(STORAGE_KEYS.library, JSON.stringify({ v: 1, data: storedLibrary }));

    const { useLibraryStore } = await import('./stores/libraryStore');
    const edited: Library = { books: [], folders: [], lastUpdated: 99 };
    useLibraryStore.getState().setLibrary(edited);

    await hydrateAppPrefsFromStorage({
      hydrateSettings: vi.fn(),
      hydrateProgress: vi.fn(),
      hydrateQuickActionConfigs: vi.fn(),
      hydrateExpandedFolderIds: vi.fn(),
    });

    expect(useLibraryStore.getState().library).toEqual(edited);
  });

  it('does not overwrite progress edited before hydration completes', async () => {
    const storedProgress: BookProgressById = {
      'book-1': { currentCfi: 'epubcfi(/6/1)', percentage: 10, lastReadAt: 1 },
    };
    localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify({ v: 1, data: storedProgress }));

    const { useProgressStore } = await import('./stores/progressStore');
    const edited: BookProgressById = {
      'book-1': { currentCfi: 'epubcfi(/6/9)', percentage: 90, lastReadAt: 9 },
    };
    useProgressStore.getState().setEntry('book-1', edited['book-1']);

    await hydrateAppPrefsFromStorage({
      hydrateSettings: vi.fn(),
      hydrateLibrary: vi.fn(),
      hydrateQuickActionConfigs: vi.fn(),
      hydrateExpandedFolderIds: vi.fn(),
    });

    expect(useProgressStore.getState().bookProgressById).toEqual(edited);
  });

  it('hydrates app prefs from localStorage when IndexedDB is unavailable', async () => {
    const libraryA: Library = { books: [book()], folders: [], lastUpdated: 2 };
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ v: 1, data: settings({ theme: 'dark' }) }));
    localStorage.setItem(STORAGE_KEYS.library, JSON.stringify({ v: 1, data: libraryA }));

    const applySettings = vi.fn();
    const applyLibrary = vi.fn();

    hydrateAppPrefsFromLocalStorage({
      hydrateSettings: applySettings,
      hydrateLibrary: applyLibrary,
      hydrateProgress: vi.fn(),
      hydrateQuickActionConfigs: vi.fn(),
      hydrateExpandedFolderIds: vi.fn(),
    });

    expect(applySettings).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
    expect(applyLibrary).toHaveBeenCalledWith(libraryA);
  });

  it('does not persist settings when hydration fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const storedSettings = settings({ theme: 'dark', fontSize: 18 });
    await saveAppPref(APP_PREF_KEYS.settings, storedSettings);

    const loadPref = vi.fn().mockRejectedValue(new Error('idb unavailable'));
    await hydrateAppPrefsFromStorage({
      loadAppPrefWithLegacyMigration: loadPref,
      hydrateSettings: vi.fn(),
      hydrateLibrary: vi.fn(),
      hydrateProgress: vi.fn(),
      hydrateQuickActionConfigs: vi.fn(),
      hydrateExpandedFolderIds: vi.fn(),
    });

    const root = mount(<PersistenceHarness settings={settings({ theme: 'light' })} library={{ books: [], folders: [], lastUpdated: 1 }} bookProgressById={{}} />);
    await vi.advanceTimersByTimeAsync(900);

    await expect(loadAppPref(APP_PREF_KEYS.settings)).resolves.toEqual(storedSettings);
    root.unmount();
    vi.useRealTimers();
  });

  it('persists settings, library, and progress through the lifecycle seam with skip-initial debounce', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    flushSync(() => {
      markAppPrefsHydrated();
    });
    const libraryA: Library = { books: [], folders: [], lastUpdated: 1 };
    const progressA: BookProgressById = {};
    const root = mount(<PersistenceHarness settings={settings()} library={libraryA} bookProgressById={progressA} />);

    await vi.advanceTimersByTimeAsync(900);
    await expect(loadAppPref(APP_PREF_KEYS.settings)).resolves.toBeUndefined();
    await expect(loadAppPref(APP_PREF_KEYS.library)).resolves.toBeUndefined();
    await expect(loadAppPref(APP_PREF_KEYS.progress)).resolves.toBeUndefined();

    const libraryB: Library = { books: [book()], folders: [], lastUpdated: 2 };
    const progressB: BookProgressById = { 'book-1': { currentCfi: 'epubcfi(/6/2)', percentage: 42, lastReadAt: 3 } };

    flushSync(() => {
      root.render(<PersistenceHarness settings={settings({ theme: 'dark' })} library={libraryB} bookProgressById={progressB} />);
    });

    await vi.advanceTimersByTimeAsync(499);
    await expect(loadAppPref(APP_PREF_KEYS.settings)).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await expect(loadAppPref(APP_PREF_KEYS.settings)).resolves.toMatchObject({ theme: 'dark' });

    await vi.advanceTimersByTimeAsync(300);
    await expect(loadAppPref(APP_PREF_KEYS.library)).resolves.toMatchObject({ lastUpdated: 2 });
    await expect(loadAppPref(APP_PREF_KEYS.progress)).resolves.toEqual(progressB);
  });

  it('persists values edited before hydration on the first post-hydration pass', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    markUserEditedPref('settings');
    markUserEditedPref('library');
    markUserEditedPref('progress');
    const editedLibrary: Library = { books: [book()], folders: [], lastUpdated: 7 };
    const editedProgress: BookProgressById = {
      'book-1': { currentCfi: 'epubcfi(/6/8)', percentage: 80, lastReadAt: 8 },
    };

    const root = mount(
      <PersistenceHarness
        settings={settings({ theme: 'dark', fontSize: 20 })}
        library={editedLibrary}
        bookProgressById={editedProgress}
      />,
    );

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(900);
    await expect(loadAppPref(APP_PREF_KEYS.settings)).resolves.toBeUndefined();

    flushSync(() => {
      markAppPrefsHydrated();
    });
    await vi.advanceTimersByTimeAsync(800);

    await expect(loadAppPref(APP_PREF_KEYS.settings)).resolves.toMatchObject({ theme: 'dark', fontSize: 20 });
    await expect(loadAppPref(APP_PREF_KEYS.library)).resolves.toMatchObject({ lastUpdated: 7 });
    await expect(loadAppPref(APP_PREF_KEYS.progress)).resolves.toEqual(editedProgress);
    root.unmount();
  });

  it('surfaces import failures as a notice and does not add a book', async () => {
    const addBook = vi.fn();
    const notice = vi.fn();

    const result = await importBookThroughLifecycle({
      filePath: '/bad/book.epub',
      books: [],
      addBook,
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

  it('imports a new EPUB and adds it to the library', async () => {
    const imported = book({ id: 'new-book', filePath: '/library/new.epub' });
    const added: Book[] = [];

    const result = await importBookThroughLifecycle({
      filePath: '/input/new.epub',
      books: [],
      addBook: (next) => added.push(next),
      importBookFromPath: vi.fn().mockResolvedValue({ status: 'imported', book: imported }),
    });

    expect(result).toBe('imported');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ id: 'new-book', filePath: '/library/new.epub' });
  });

  it('prepares an opened book by merging stored progress and bumping lastReadAt', () => {
    const prepared = prepareBookOpen({
      book: book(),
      storedProgress: { currentCfi: 'epubcfi(/6/2)', percentage: 64, lastReadAt: 1 },
      now: () => 2,
    });

    expect(prepared.book).toMatchObject({
      id: 'book-1',
      lastReadAt: 2,
      progress: { currentCfi: 'epubcfi(/6/2)', percentage: 64 },
    });
    expect(prepared.progressEntry).toEqual({ currentCfi: 'epubcfi(/6/2)', percentage: 64, lastReadAt: 2 });
  });

  it('opens a book through the lifecycle seam and writes the progress entry', () => {
    const currentBook = vi.fn();
    const progressEntry = vi.fn();

    openBookThroughLifecycle({
      book: book(),
      progressById: {},
      setCurrentBook: currentBook,
      setProgressEntry: progressEntry,
      now: () => 3,
    });

    expect(progressEntry).toHaveBeenCalledWith('book-1', { currentCfi: '', percentage: 0, lastReadAt: 3 });
    expect(currentBook).toHaveBeenCalledWith(expect.objectContaining({ id: 'book-1', lastReadAt: 3 }));
  });

  it('removes a book through the lifecycle seam and runs cleanup side effects', async () => {
    const target = book({ id: 'book-1', filePath: '/library/book.epub' });
    const removeBook = vi.fn();
    const removeProgressEntry = vi.fn();
    const setCurrentBook = vi.fn();
    const deleteCover = vi.fn().mockResolvedValue(undefined);
    const revokeCoverUrl = vi.fn();
    const deleteNativeBookFile = vi.fn().mockResolvedValue(undefined);

    removeBookThroughLifecycle({
      bookId: target.id,
      books: [target],
      currentBook: target,
      removeBook,
      removeProgressEntry,
      setCurrentBook,
      deleteCover,
      revokeCoverUrl,
      deleteNativeBookFile,
    });
    await Promise.resolve();

    expect(deleteCover).toHaveBeenCalledWith('book-1');
    expect(revokeCoverUrl).toHaveBeenCalledWith('book-1');
    expect(removeProgressEntry).toHaveBeenCalledWith('book-1');
    expect(deleteNativeBookFile).toHaveBeenCalledWith('/library/book.epub');
    expect(removeBook).toHaveBeenCalledWith('book-1');
    expect(setCurrentBook).toHaveBeenCalledWith(null);
  });

  it('skips importing an existing file path', async () => {
    const importBook = vi.fn();
    const result = await importBookThroughLifecycle({
      filePath: '/books/book.epub',
      books: [book()],
      addBook: vi.fn(),
      importBookFromPath: importBook,
    });

    expect(result).toBe('skipped');
    expect(importBook).not.toHaveBeenCalled();
  });

  it('surfaces file import failures as a notice and does not add a book', async () => {
    const addBook = vi.fn();
    const notice = vi.fn();
    const file = new File(['x'], 'broken.epub', { type: 'application/epub+zip' });

    const result = await importBookFileThroughLifecycle({
      file,
      books: [],
      addBook,
      notice,
      importBookFromFile: vi.fn().mockRejectedValue(new Error('Unreadable EPUB')),
    });

    expect(result).toBe('failed');
    expect(addBook).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith({
      title: '无法导入 EPUB',
      message: 'Unreadable EPUB',
    });
  });

  it('imports a new EPUB file and adds it to the library', async () => {
    const imported = book({ id: 'new-book', filePath: '/library/new.epub' });
    const added: Book[] = [];
    const file = new File(['x'], 'new.epub', { type: 'application/epub+zip' });

    const result = await importBookFileThroughLifecycle({
      file,
      books: [],
      addBook: (next) => added.push(next),
      importBookFromFile: vi.fn().mockResolvedValue({ status: 'imported', book: imported }),
    });

    expect(result).toBe('imported');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ id: 'new-book', filePath: '/library/new.epub' });
  });

  it('skips importing when file import reports a duplicate', async () => {
    const file = new File(['x'], 'book.epub', { type: 'application/epub+zip' });
    const importBookFromFile = vi.fn().mockResolvedValue({ status: 'skipped', reason: 'duplicate' });

    const result = await importBookFileThroughLifecycle({
      file,
      books: [book({ filePath: '/library/book.epub' })],
      addBook: vi.fn(),
      importBookFromFile,
    });

    expect(result).toBe('skipped');
    expect(importBookFromFile).toHaveBeenCalledOnce();
  });

  it('migrates inline cover data URLs on the lifecycle path and respects cancellation', async () => {
    const library: Library = {
      books: [
        book({ id: 'cover-book', cover: 'data:image/png;base64,abc' }),
        book({ id: 'existing-cover', cover: 'data:image/png;base64,abc', coverKey: 'existing-cover' }),
      ],
      folders: [],
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
    const initial: Library = { books: [book({ filePath: '/old.epub' })], folders: [], lastUpdated: 1 };
    const updated: Library = { books: [book({ filePath: '/fixed.epub' })], folders: [], lastUpdated: 2 };
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
    const initial: Library = { books: [current], folders: [], lastUpdated: 1 };
    const updatedBook = book({ id: 'book-1', filePath: '/fixed.epub' });
    const updated: Library = { books: [updatedBook], folders: [], lastUpdated: 2 };
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
