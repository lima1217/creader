import type { Settings, Library, ChatMessage, ReadingProgress, BookFolder } from '../../types';
import { loadStored, STORAGE_KEYS } from '../../services/LocalStore';

export type BookProgressById = Record<string, ReadingProgress & { lastReadAt: number }>;

function normalizeProgress(progress: ReadingProgress): ReadingProgress {
  const cfi = progress.currentCfi;
  if (typeof cfi === 'string' && (cfi.startsWith('page:') || cfi.startsWith('scroll:'))) {
    return {
      ...progress,
      currentCfi: '',
    };
  }

  return progress;
}

function asStoredEntry(value: unknown): (ReadingProgress & { lastReadAt: number }) | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as any;

  if (typeof v.percentage === 'number' && typeof v.lastReadAt === 'number' && typeof v.currentCfi === 'string') {
    const { lastReadAt, ...progress } = v as ReadingProgress & { lastReadAt: number };
    return { ...normalizeProgress(progress), lastReadAt };
  }

  // Legacy format: { currentCfi, percentage, lastReadAt }
  if (typeof v.percentage === 'number' && typeof v.currentCfi === 'string') {
    const lastReadAt = typeof v.lastReadAt === 'number' ? v.lastReadAt : 0;
    const progress: ReadingProgress = normalizeProgress({
      currentCfi: v.currentCfi,
      percentage: v.percentage,
    });
    return { ...progress, lastReadAt };
  }

  return null;
}

function normalizeAIContextWindow(value: unknown, fallback: Settings['aiContextWindow']): Settings['aiContextWindow'] {
  return value === 5 || value === 20 || value === 40 ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function normalizeFolders(rawLibrary: unknown): BookFolder[] {
  const library = asRecord(rawLibrary);
  const rawFolders = Array.isArray(library.folders) ? library.folders : [];
  if (rawFolders.length > 0) {
    return rawFolders
      .map((raw, index) => {
        const folder = asRecord(raw);
        const id = typeof folder.id === 'string' ? folder.id : '';
        const name = typeof folder.name === 'string' ? folder.name : '';
        if (!id || !name) return null;
        return {
          id,
          name,
          sortOrder: typeof folder.sortOrder === 'number' ? folder.sortOrder : index,
          createdAt: typeof folder.createdAt === 'number' ? folder.createdAt : 0,
        };
      })
      .filter((folder): folder is BookFolder => folder !== null);
  }

  const rawCategories = Array.isArray(library.categories) ? library.categories : [];
  return rawCategories
    .map((raw, index) => {
      const category = asRecord(raw);
      const id = typeof category.id === 'string' ? category.id : '';
      const name = typeof category.name === 'string' ? category.name : '';
      if (!id || !name) return null;
      return {
        id,
        name,
        sortOrder: index,
        createdAt: typeof category.createdAt === 'number' ? category.createdAt : 0,
      };
    })
    .filter((folder): folder is BookFolder => folder !== null);
}

export function normalizeLibrary(rawLibrary: unknown, now: () => number = Date.now): Library {
  const library = asRecord(rawLibrary);
  const folders = normalizeFolders(rawLibrary);
  const folderIds = new Set(folders.map(folder => folder.id));
  const rawBooks = Array.isArray(library.books) ? library.books : [];
  const books = rawBooks.map(raw => {
    const book = asRecord(raw);
    const { categoryId: _categoryId, ...rest } = book;
    const folderId = typeof book.folderId === 'string'
      ? book.folderId
      : typeof _categoryId === 'string'
        ? _categoryId
        : undefined;
    return {
      ...rest,
      ...(folderId && folderIds.has(folderId) ? { folderId } : {}),
    };
  }) as Library['books'];

  return {
    books,
    folders,
    lastUpdated: typeof library.lastUpdated === 'number' ? library.lastUpdated : now(),
  };
}

export function getInitialSettings(defaultSettings: Settings): Settings {
  const stored = loadStored(STORAGE_KEYS.settings, defaultSettings);
  return {
    ...defaultSettings,
    ...stored,
    // Sepia was retired in Astryx Phase 1; coerce any stale persisted value to light.
    theme: stored.theme === 'dark' ? 'dark' : 'light',
    aiTextSize: typeof stored.aiTextSize === 'number'
      ? Math.min(20, Math.max(13, stored.aiTextSize))
      : defaultSettings.aiTextSize,
    aiContextWindow: normalizeAIContextWindow(stored.aiContextWindow, defaultSettings.aiContextWindow),
    aiAutoSummarize: typeof stored.aiAutoSummarize === 'boolean'
      ? stored.aiAutoSummarize
      : defaultSettings.aiAutoSummarize,
  };
}

export function getInitialLibrary(): Library {
  const fallback: Library = { books: [], folders: [], lastUpdated: Date.now() };
  return normalizeLibrary(loadStored(STORAGE_KEYS.library, fallback));
}

export function getInitialChatMessages(): ChatMessage[] {
  // Chat messages are now persisted in IndexedDB and hydrated asynchronously.
  // Keep the synchronous initial state lightweight.
  return [];
}

export function getInitialBookProgressById(): BookProgressById {
  const stored = loadStored<Record<string, unknown>>(STORAGE_KEYS.progress, {});
  const migrated: BookProgressById = {};
  for (const [id, raw] of Object.entries(stored)) {
    const entry = asStoredEntry(raw);
    if (entry) migrated[id] = entry;
  }
  if (Object.keys(migrated).length > 0) return migrated;

  const legacyLibrary = normalizeLibrary(loadStored<Library>(STORAGE_KEYS.library, { books: [], folders: [], lastUpdated: Date.now() }));
  const seeded: BookProgressById = {};
  for (const book of legacyLibrary.books) {
    const normalized = normalizeProgress(book.progress);
    seeded[book.id] = {
      ...normalized,
      lastReadAt: book.lastReadAt ?? 0,
    };
  }
  return seeded;
}
