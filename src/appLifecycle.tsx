import { useCallback, useEffect, useState } from 'react';
import { importBookFromPath } from './services/BookImportService';
import { dataUrlToBlob, deleteCover, revokeCoverUrl, saveCover } from './services/CoverStore';
import { loadChatMessages, loadConversationMemory, replaceChatMessages } from './services/ChatStore';
import { validateAndFixLibraryPaths } from './services/BookPathValidator';
import { STORAGE_KEYS, loadStored } from './services/LocalStore';
import { APP_PREF_KEYS } from './services/DexieDb';
import { loadAppPrefWithLegacyMigration } from './services/AppPrefsStore';
import { isIndexedDbAvailable } from './services/indexedDbAvailability';
import { writeThemePlaceholder } from './services/themePlaceholder';
import {
  markAppPrefsHydrated,
  markAppPrefsHydrationFailed,
  wasPrefEditedBeforeHydration,
} from './services/appPrefsHydration';
import { useDebouncedDexiePersist } from './hooks/useDebouncedDexiePersist';
import { useDebouncedLocalStoragePersist } from './hooks/useDebouncedLocalStoragePersist';
import { useCanPersistAppPrefs } from './hooks/useCanPersistAppPrefs';
import { useSettingsStore, hydrateSettings } from './stores/settingsStore';
import { useLibraryStore, getLatestCurrentBook, getLatestLibrary, hydrateLibrary } from './stores/libraryStore';
import { useProgressStore, hydrateProgress } from './stores/progressStore';
import { hydrateChatMessages, hydrateConversationMemory } from './stores/aiStore';
import { hydrateQuickActionConfigs } from './components/ai/quickActionStorage';
import { defaultQuickActions } from './components/ai/quickActions';
import { hydrateExpandedFolderIds } from './hooks/expandedFoldersStorage';
import { MAX_CHAT_MESSAGES_STORED } from './constants';
import { createLogger } from './utils/logger';
import { perfSpan } from './utils/perf';
import type { Book, ChatMessage, ConversationMemory, Library, Settings } from './types';
import {
  type BookProgressById,
  DEFAULT_SETTINGS,
  getEmptyLibrary,
  resolveBookProgressById,
  resolveSettings,
} from './stores/app/initialState';
import { normalizeLibrary } from './domain/libraryNormalization';

const importLogger = createLogger('Import');
const lifecycleLogger = createLogger('AppLifecycle');

type Scheduler = (
  task: () => void,
  options: { timeout: number; fallbackMs: number },
) => () => void;

export const scheduleIdleTask: Scheduler = (task, options) => {
  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (typeof w.requestIdleCallback === 'function') {
    const handle = w.requestIdleCallback(task, { timeout: options.timeout });
    return () => w.cancelIdleCallback?.(handle);
  }

  const timer = window.setTimeout(task, options.fallbackMs);
  return () => window.clearTimeout(timer);
};

export async function hydrateConversationMemoryFromStorage(params: {
  loadConversationMemory?: () => Promise<ConversationMemory | null>;
  hydrateConversationMemory?: (memory: ConversationMemory | null) => void;
  isCancelled?: () => boolean;
} = {}): Promise<void> {
  const load = params.loadConversationMemory ?? loadConversationMemory;
  const hydrate = params.hydrateConversationMemory ?? hydrateConversationMemory;

  try {
    const memory = await load();
    if (!params.isCancelled?.()) hydrate(memory);
  } catch (error) {
    lifecycleLogger.warn('Failed to load conversation memory:', error);
  }
}

export async function hydrateChatMessagesFromStorage(params: {
  loadChatMessages?: (limit: number) => Promise<ChatMessage[]>;
  replaceChatMessages?: (messages: ChatMessage[], limit: number) => Promise<void>;
  loadStored?: <T>(key: string, defaultValue: T) => T;
  removeLegacy?: (key: string) => void;
  hydrateChatMessages?: (messages: ChatMessage[]) => void;
  limit?: number;
  isCancelled?: () => boolean;
} = {}): Promise<void> {
  const load = params.loadChatMessages ?? loadChatMessages;
  const replace = params.replaceChatMessages ?? replaceChatMessages;
  const loadLegacy = params.loadStored ?? loadStored;
  const removeLegacy = params.removeLegacy ?? ((key) => localStorage.removeItem(key));
  const hydrate = params.hydrateChatMessages ?? hydrateChatMessages;
  const limit = params.limit ?? MAX_CHAT_MESSAGES_STORED;

  try {
    const stored = await load(limit);
    if (params.isCancelled?.()) return;

    if (stored.length > 0) {
      hydrate(stored);
      return;
    }

    const legacy = loadLegacy<ChatMessage[]>(STORAGE_KEYS.chat, []);
    if (legacy.length > 0) {
      const trimmed = legacy.slice(-limit);
      await replace(trimmed, limit);
      removeLegacy(STORAGE_KEYS.chat);
      if (!params.isCancelled?.()) hydrate(trimmed);
    }
  } catch (error) {
    lifecycleLogger.warn('Failed to hydrate chat messages:', error);
  }
}

export async function hydrateAppPrefsFromStorage(params: {
  loadAppPrefWithLegacyMigration?: typeof loadAppPrefWithLegacyMigration;
  removeLegacy?: (key: string) => void;
  hydrateSettings?: (settings: Settings) => void;
  hydrateLibrary?: (library: Library) => void;
  hydrateProgress?: (bookProgressById: BookProgressById) => void;
  hydrateQuickActionConfigs?: (actions: typeof defaultQuickActions) => void;
  hydrateExpandedFolderIds?: (ids: string[], persisted: boolean) => void;
  isCancelled?: () => boolean;
} = {}): Promise<void> {
  const loadPref = params.loadAppPrefWithLegacyMigration ?? loadAppPrefWithLegacyMigration;
  const removeLegacy = params.removeLegacy ?? ((key) => localStorage.removeItem(key));
  const applySettings = params.hydrateSettings ?? hydrateSettings;
  const applyLibrary = params.hydrateLibrary ?? hydrateLibrary;
  const applyProgress = params.hydrateProgress ?? hydrateProgress;
  const applyQuickActions = params.hydrateQuickActionConfigs ?? hydrateQuickActionConfigs;
  const applyExpandedFolders = params.hydrateExpandedFolderIds ?? hydrateExpandedFolderIds;

  try {
    const [settingsResult, libraryResult, progressResult, quickActionsResult, expandedFoldersResult] = await Promise.all([
      loadPref(APP_PREF_KEYS.settings, DEFAULT_SETTINGS, removeLegacy),
      loadPref(APP_PREF_KEYS.library, getEmptyLibrary(), removeLegacy),
      loadPref(APP_PREF_KEYS.progress, {} as Record<string, unknown>, removeLegacy),
      loadPref(APP_PREF_KEYS.quickActions, defaultQuickActions, removeLegacy),
      loadPref(APP_PREF_KEYS.libraryOrganizerExpandedFolders, [] as string[], removeLegacy),
    ]);
    if (params.isCancelled?.()) return;

    const settings = resolveSettings(settingsResult.value, DEFAULT_SETTINGS);
    const library = normalizeLibrary(libraryResult.value);
    const bookProgressById = resolveBookProgressById(progressResult.value, library);

    applySettings(settings);
    applyLibrary(library);
    applyProgress(bookProgressById);
    applyQuickActions(quickActionsResult.value);
    applyExpandedFolders(expandedFoldersResult.value, expandedFoldersResult.persisted);
    markAppPrefsHydrated();
  } catch (error) {
    lifecycleLogger.warn('Failed to hydrate app prefs:', error);
    markAppPrefsHydrationFailed();
  }
}

export function hydrateAppPrefsFromLocalStorage(params: {
  loadStored?: <T>(key: string, defaultValue: T) => T;
  hydrateSettings?: (settings: Settings) => void;
  hydrateLibrary?: (library: Library) => void;
  hydrateProgress?: (bookProgressById: BookProgressById) => void;
  hydrateQuickActionConfigs?: (actions: typeof defaultQuickActions) => void;
  hydrateExpandedFolderIds?: (ids: string[], persisted: boolean) => void;
  isCancelled?: () => boolean;
} = {}): void {
  const loadLegacy = params.loadStored ?? loadStored;
  const applySettings = params.hydrateSettings ?? hydrateSettings;
  const applyLibrary = params.hydrateLibrary ?? hydrateLibrary;
  const applyProgress = params.hydrateProgress ?? hydrateProgress;
  const applyQuickActions = params.hydrateQuickActionConfigs ?? hydrateQuickActionConfigs;
  const applyExpandedFolders = params.hydrateExpandedFolderIds ?? hydrateExpandedFolderIds;

  try {
    const settings = resolveSettings(loadLegacy(STORAGE_KEYS.settings, DEFAULT_SETTINGS), DEFAULT_SETTINGS);
    const library = normalizeLibrary(loadLegacy(STORAGE_KEYS.library, getEmptyLibrary()));
    const bookProgressById = resolveBookProgressById(
      loadLegacy(STORAGE_KEYS.progress, {} as Record<string, unknown>),
      library,
    );
    const quickActions = loadLegacy(STORAGE_KEYS.quickActions, defaultQuickActions);
    const expandedFolders = loadLegacy(STORAGE_KEYS.libraryOrganizerExpandedFolders, [] as string[]);

    if (params.isCancelled?.()) return;

    applySettings(settings);
    applyLibrary(library);
    applyProgress(bookProgressById);
    applyQuickActions(quickActions);
    applyExpandedFolders(expandedFolders, localStorage.getItem(STORAGE_KEYS.libraryOrganizerExpandedFolders) !== null);
    markAppPrefsHydrated();
  } catch (error) {
    lifecycleLogger.warn('Failed to hydrate app prefs from localStorage:', error);
    markAppPrefsHydrationFailed();
  }
}

export async function migrateInlineCovers(params: {
  library: Library;
  dataUrlToBlob?: (dataUrl: string) => Promise<Blob>;
  saveCover?: (bookId: string, blob: Blob) => Promise<void>;
  applyLibrary?: (updater: (library: Library) => Library) => void;
  now?: () => number;
  isCancelled?: () => boolean;
}): Promise<void> {
  const toMigrate = params.library.books.filter(b => !!b.cover && b.cover.startsWith('data:') && !b.coverKey);
  if (toMigrate.length === 0) return;

  const toBlob = params.dataUrlToBlob ?? dataUrlToBlob;
  const persistCover = params.saveCover ?? saveCover;
  const now = params.now ?? Date.now;
  const applyLibrary = params.applyLibrary ?? ((updater) => {
    const state = useLibraryStore.getState();
    state.setLibrary(updater(state.library));
  });

  await perfSpan('startup:migrateCovers', async () => {
    const migratedIds = new Set<string>();
    for (const book of toMigrate) {
      if (params.isCancelled?.()) return;
      try {
        const blob = await toBlob(book.cover as string);
        await persistCover(book.id, blob);
        migratedIds.add(book.id);
      } catch (error) {
        lifecycleLogger.error('Failed to migrate cover:', error);
      }
    }

    if (params.isCancelled?.() || migratedIds.size === 0) return;

    applyLibrary((library) => ({
      ...library,
      books: library.books.map(b => migratedIds.has(b.id) ? { ...b, cover: undefined, coverKey: b.id } : b),
      lastUpdated: now(),
    }));
  });
}

export async function validateStartupBookPaths(params: {
  getLibrary?: () => Library;
  getCurrentBook?: () => Book | null;
  validateAndFixLibraryPaths?: (library: Library) => Promise<{
    updatedLibrary: Library;
    fixedBooks: string[];
    brokenBooks: string[];
  }>;
  setLibrary?: (library: Library) => void;
  setCurrentBook?: (book: Book | null) => void;
  isCancelled?: () => boolean;
} = {}): Promise<void> {
  const getLibrary = params.getLibrary ?? getLatestLibrary;
  const getCurrentBook = params.getCurrentBook ?? getLatestCurrentBook;
  const validate = params.validateAndFixLibraryPaths ?? validateAndFixLibraryPaths;
  const setLibrary = params.setLibrary ?? useLibraryStore.getState().setLibrary;
  const setCurrentBook = params.setCurrentBook ?? useLibraryStore.getState().replaceCurrentBookSnapshot;

  const snapshot = getLibrary();
  if (!snapshot || snapshot.books.length === 0) return;

  try {
    const result = await perfSpan('startup:validateAndFixLibraryPaths', async () => validate(snapshot));
    if (params.isCancelled?.()) return;

    if (result.fixedBooks.length > 0) {
      lifecycleLogger.debug(`Fixed paths for ${result.fixedBooks.length} book(s)`);
    }
    if (result.brokenBooks.length > 0) {
      lifecycleLogger.warn(`Could not find files for ${result.brokenBooks.length} book(s)`);
    }

    if (result.fixedBooks.length === 0) return;

    const latest = getLibrary();
    if (latest.lastUpdated !== snapshot.lastUpdated) return;

    setLibrary(result.updatedLibrary);

    const current = getCurrentBook();
    if (current && result.fixedBooks.includes(current.id)) {
      const updated = result.updatedLibrary.books.find(b => b.id === current.id);
      if (updated && updated.filePath !== current.filePath) {
        setCurrentBook({ ...current, filePath: updated.filePath });
      }
    }
  } catch (error) {
    lifecycleLogger.error('Failed to validate book paths:', error);
  }
}

export async function importBookThroughLifecycle(params: {
  filePath: string;
  isImporting?: boolean;
  books: Book[];
  addBook: (book: Book) => void;
  setIsImporting?: (value: boolean) => void;
  notice?: (options: { title: string; message: string }) => void;
  importBookFromPath?: typeof importBookFromPath;
}): Promise<'imported' | 'skipped' | 'busy' | 'failed'> {
  if (params.isImporting) return 'busy';

  const existingFilePaths = new Set(params.books.map(b => b.filePath));
  if (existingFilePaths.has(params.filePath)) {
    importLogger.debug('Book already in library:', params.filePath);
    return 'skipped';
  }

  const importBook = params.importBookFromPath ?? importBookFromPath;

  try {
    params.setIsImporting?.(true);
    importLogger.debug('Starting import process for:', params.filePath);

    const result = await importBook({
      filePath: params.filePath,
      existingFilePaths,
    });
    if (result.status === 'skipped') {
      importLogger.debug('Import skipped:', result.reason);
      return 'skipped';
    }

    const newBook: Book = { ...result.book };
    importLogger.debug('Adding book to library:', newBook);
    params.addBook(newBook);
    importLogger.debug('Import completed successfully');
    return 'imported';
  } catch (error) {
    importLogger.error('Failed to import book:', error);
    if (error instanceof Error) importLogger.debug('Error details:', error.message, error.stack);
    params.notice?.({
      title: '无法导入 EPUB',
      message: error instanceof Error ? error.message : '未知错误',
    });
    return 'failed';
  } finally {
    params.setIsImporting?.(false);
  }
}

export function prepareBookOpen(params: {
  book: Book;
  storedProgress?: BookProgressById[string];
  now?: () => number;
}): {
  book: Book;
  progressEntry: BookProgressById[string];
} {
  const now = params.now ?? Date.now;
  const lastReadAt = now();
  const storedProgress = params.storedProgress;
  const progressEntry = storedProgress
    ? { ...storedProgress, lastReadAt }
    : { ...params.book.progress, lastReadAt };
  const progress = storedProgress
    ? {
        ...params.book.progress,
        currentCfi: storedProgress.currentCfi,
        percentage: storedProgress.percentage,
      }
    : params.book.progress;

  return {
    book: { ...params.book, progress, lastReadAt },
    progressEntry,
  };
}

export function openBookThroughLifecycle(params: {
  book: Book | null;
  progressById?: BookProgressById;
  setProgressEntry?: (id: string, entry: BookProgressById[string]) => void;
  setCurrentBook?: (book: Book | null) => void;
  now?: () => number;
}): void {
  const setCurrentBook = params.setCurrentBook ?? useLibraryStore.getState().setCurrentBook;

  if (!params.book) {
    setCurrentBook(null);
    return;
  }

  const progressById = params.progressById ?? useProgressStore.getState().bookProgressById;
  const prepared = prepareBookOpen({
    book: params.book,
    storedProgress: progressById[params.book.id],
    now: params.now,
  });
  const setProgressEntry = params.setProgressEntry ?? useProgressStore.getState().setEntry;
  setProgressEntry(params.book.id, prepared.progressEntry);
  setCurrentBook(prepared.book);
}

export async function deleteNativeBookFile(params: {
  filePath?: string;
  invoke?: (cmd: string, args: { filePath: string }) => Promise<unknown>;
}): Promise<void> {
  if (!params.filePath) return;

  try {
    const invoke = params.invoke ?? (await import('@tauri-apps/api/core')).invoke;
    await invoke('delete_book_file', { filePath: params.filePath });
  } catch (error) {
    lifecycleLogger.warn('Failed to delete book file:', error);
  }
}

export function removeBookThroughLifecycle(params: {
  bookId: string;
  books?: Book[];
  currentBook?: Book | null;
  removeBook?: (id: string) => void;
  removeProgressEntry?: (id: string) => void;
  setCurrentBook?: (book: Book | null) => void;
  deleteCover?: (bookId: string) => Promise<void>;
  revokeCoverUrl?: (bookId: string) => void;
  deleteNativeBookFile?: (filePath?: string) => Promise<void>;
}): void {
  const books = params.books ?? useLibraryStore.getState().library.books;
  const book = books.find((candidate) => candidate.id === params.bookId);
  const removeBook = params.removeBook ?? useLibraryStore.getState().removeBook;
  const removeProgressEntry = params.removeProgressEntry ?? useProgressStore.getState().removeEntry;
  const setCurrentBook = params.setCurrentBook ?? ((nextBook) => openBookThroughLifecycle({ book: nextBook }));
  const removeCover = params.deleteCover ?? deleteCover;
  const revokeCover = params.revokeCoverUrl ?? revokeCoverUrl;
  const removeNativeFile = params.deleteNativeBookFile ?? ((filePath) => deleteNativeBookFile({ filePath }));

  void removeCover(params.bookId);
  revokeCover(params.bookId);
  removeProgressEntry(params.bookId);
  if (book?.filePath) void removeNativeFile(book.filePath);

  removeBook(params.bookId);
  const currentBook = params.currentBook ?? useLibraryStore.getState().currentBook;
  if (currentBook?.id === params.bookId) setCurrentBook(null);
}

export function useAppLifecycleBootstrap(): void {
  const settings = useSettingsStore((s) => s.settings);
  const library = useLibraryStore((s) => s.library);
  const bookProgressById = useProgressStore((s) => s.bookProgressById);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
    writeThemePlaceholder(settings.theme);
  }, [settings.theme]);

  useAppLifecyclePersistence({ settings, library, bookProgressById });

  useEffect(() => {
    let cancelled = false;
    let cancelValidation: (() => void) | undefined;

    if (isIndexedDbAvailable()) {
      void hydrateAppPrefsFromStorage({ isCancelled: () => cancelled }).then(() => {
        if (cancelled) return;
        cancelValidation = scheduleIdleTask(() => {
          void validateStartupBookPaths({ isCancelled: () => cancelled });
        }, { timeout: 2000, fallbackMs: 200 });
      });
    } else {
      hydrateAppPrefsFromLocalStorage({ isCancelled: () => cancelled });
      cancelValidation = scheduleIdleTask(() => {
        void validateStartupBookPaths({ isCancelled: () => cancelled });
      }, { timeout: 2000, fallbackMs: 200 });
    }

    return () => {
      cancelled = true;
      cancelValidation?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cancel = scheduleIdleTask(() => {
      void migrateInlineCovers({
        library,
        isCancelled: () => cancelled,
      });
    }, { timeout: 3500, fallbackMs: 1200 });

    return () => {
      cancelled = true;
      cancel();
    };
  }, [library.books]);

  useEffect(() => {
    if (typeof indexedDB === 'undefined') return;
    let cancelled = false;
    void hydrateConversationMemoryFromStorage({ isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof indexedDB === 'undefined') return;
    let cancelled = false;
    const cancel = scheduleIdleTask(() => {
      void hydrateChatMessagesFromStorage({ isCancelled: () => cancelled });
    }, { timeout: 1500, fallbackMs: 600 });

    return () => {
      cancelled = true;
      cancel();
    };
  }, []);
}

export function useAppLifecyclePersistence(params: {
  settings: Settings;
  library: Library;
  bookProgressById: BookProgressById;
}): void {
  const canPersist = useCanPersistAppPrefs();
  const useDexie = isIndexedDbAvailable();
  const enabled = canPersist;

  useDebouncedDexiePersist(APP_PREF_KEYS.settings, params.settings, 500, {
    skipInitial: !wasPrefEditedBeforeHydration('settings'),
    enabled: enabled && useDexie,
  });
  useDebouncedDexiePersist(APP_PREF_KEYS.library, params.library, 800, {
    skipInitial: !wasPrefEditedBeforeHydration('library'),
    enabled: enabled && useDexie,
  });
  useDebouncedDexiePersist(APP_PREF_KEYS.progress, params.bookProgressById, 800, {
    skipInitial: !wasPrefEditedBeforeHydration('progress'),
    enabled: enabled && useDexie,
  });

  useDebouncedLocalStoragePersist(STORAGE_KEYS.settings, params.settings, 500, {
    skipInitial: !wasPrefEditedBeforeHydration('settings'),
    enabled: enabled && !useDexie,
  });
  useDebouncedLocalStoragePersist(STORAGE_KEYS.library, params.library, 800, {
    skipInitial: !wasPrefEditedBeforeHydration('library'),
    enabled: enabled && !useDexie,
  });
  useDebouncedLocalStoragePersist(STORAGE_KEYS.progress, params.bookProgressById, 800, {
    skipInitial: !wasPrefEditedBeforeHydration('progress'),
    enabled: enabled && !useDexie,
  });
}

export function useAppLifecycleImport(params: {
  notice: (options: { title: string; message: string }) => void;
}): {
  isImporting: boolean;
  importBook: (filePath: string) => Promise<void>;
} {
  const addBook = useLibraryStore((s) => s.addBook);
  const libraryBooks = useLibraryStore((s) => s.library.books);
  const [isImporting, setIsImporting] = useState(false);

  const importBook = useCallback(async (filePath: string) => {
    await importBookThroughLifecycle({
      filePath,
      isImporting,
      books: libraryBooks,
      addBook,
      setIsImporting,
      notice: params.notice,
    });
  }, [addBook, isImporting, libraryBooks, params.notice]);

  return { isImporting, importBook };
}
