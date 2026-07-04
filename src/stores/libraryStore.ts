import { create } from 'zustand';
import type { Book, BookFolder, Library, SearchIndexSummary } from '../types';
import { getInitialLibrary, normalizeLibrary } from './app/initialState';

/**
 * Library + current book (issue #13), persisted via debounced localStorage.
 *
 * Mutators here are in-memory library state transitions. Cross-store progress
 * updates, cover cleanup, native file deletion, and open-book orchestration
 * live in the App Lifecycle seam.
 *
 * `latestLibrary` / `latestCurrentBook` are module-level mirrors of the same
 * race-safety refs the original provider kept (`latestLibraryRef` /
 * `latestCurrentBookRef`); the one-shot path-validation effect in
 * `AppBootstrap` reads them after an idle delay.
 */
let latestLibrary: Library = getInitialLibrary();
let latestCurrentBook: Book | null = null;

/** Read-only snapshot of the most recent library (mirrors the old ref). */
export function getLatestLibrary(): Library {
  return latestLibrary;
}

/** Read-only snapshot of the most recent current book (mirrors the old ref). */
export function getLatestCurrentBook(): Book | null {
  return latestCurrentBook;
}

type LibraryState = {
  library: Library;
  setLibrary: (library: Library) => void;
  addBook: (book: Book) => void;
  removeBook: (id: string) => void;
  updateBook: (id: string, updates: Partial<Pick<Book, 'title' | 'author' | 'folderId'>>) => void;
  updateBookFilePath: (id: string, newFilePath: string) => void;
  updateBookSearchIndex: (id: string, searchIndex: SearchIndexSummary) => void;
  addFolder: (name: string) => BookFolder;
  removeFolder: (id: string) => void;
  updateFolder: (id: string, updates: Partial<Pick<BookFolder, 'name' | 'sortOrder'>>) => void;
  setBookFolder: (bookId: string, folderId: string | undefined) => void;
  currentBook: Book | null;
  /** Pure setter. User open-book flows should use App Lifecycle orchestration. */
  setCurrentBook: (book: Book | null) => void;
  /** Replace currentBook without open-book side effects. Internal startup seam. */
  replaceCurrentBookSnapshot: (book: Book | null) => void;
};

function syncLibrary(next: Library) {
  latestLibrary = next;
}

function syncCurrentBook(next: Book | null) {
  latestCurrentBook = next;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  library: latestLibrary,
  setLibrary: (library) => {
    const next = normalizeLibrary(library);
    syncLibrary(next);
    set({ library: next });
  },

  addBook: (book) => {
    const next: Library = {
      ...latestLibrary,
      books: [...latestLibrary.books, book],
      lastUpdated: Date.now(),
    };
    syncLibrary(next);
    set({ library: next });
  },

  removeBook: (id) => {
    const next: Library = {
      ...latestLibrary,
      books: latestLibrary.books.filter((b) => b.id !== id),
      lastUpdated: Date.now(),
    };
    syncLibrary(next);
    set({ library: next });
  },

  updateBook: (id, updates) => {
    const next: Library = {
      ...latestLibrary,
      books: latestLibrary.books.map((b) => (b.id === id ? { ...b, ...updates } : b)),
      lastUpdated: Date.now(),
    };
    syncLibrary(next);
    const currentBook = latestCurrentBook?.id === id ? { ...latestCurrentBook, ...updates } : latestCurrentBook;
    syncCurrentBook(currentBook);
    set({ library: next, currentBook });
  },

  updateBookFilePath: (id, newFilePath) => {
    const pending: SearchIndexSummary = { state: 'pending' };
    const next: Library = {
      ...latestLibrary,
      books: latestLibrary.books.map((b) =>
        b.id === id ? { ...b, filePath: newFilePath, searchIndex: pending } : b,
      ),
      lastUpdated: Date.now(),
    };
    syncLibrary(next);
    const currentBook =
      latestCurrentBook?.id === id
        ? { ...latestCurrentBook, filePath: newFilePath, searchIndex: pending }
        : latestCurrentBook;
    syncCurrentBook(currentBook);
    set({ library: next, currentBook });
  },

  updateBookSearchIndex: (id, searchIndex) => {
    const next: Library = {
      ...latestLibrary,
      books: latestLibrary.books.map((b) => (b.id === id ? { ...b, searchIndex } : b)),
      lastUpdated: Date.now(),
    };
    syncLibrary(next);
    const currentBook =
      latestCurrentBook?.id === id ? { ...latestCurrentBook, searchIndex } : latestCurrentBook;
    syncCurrentBook(currentBook);
    set({ library: next, currentBook });
  },

  addFolder: (name) => {
    const sortOrder = latestLibrary.folders.reduce(
      (max, folder) => Math.max(max, folder.sortOrder),
      -1,
    ) + 1;
    const newFolder: BookFolder = {
      id: Date.now().toString(),
      name,
      sortOrder,
      createdAt: Date.now(),
    };
    const next: Library = {
      ...latestLibrary,
      folders: [...latestLibrary.folders, newFolder],
      lastUpdated: Date.now(),
    };
    syncLibrary(next);
    set({ library: next });
    return newFolder;
  },

  removeFolder: (id) => {
    const next: Library = {
      ...latestLibrary,
      folders: latestLibrary.folders.filter((folder) => folder.id !== id),
      books: latestLibrary.books.map((b) =>
        b.folderId === id ? { ...b, folderId: undefined } : b,
      ),
      lastUpdated: Date.now(),
    };
    syncLibrary(next);
    const currentBook =
      latestCurrentBook?.folderId === id ? { ...latestCurrentBook, folderId: undefined } : latestCurrentBook;
    syncCurrentBook(currentBook);
    set({ library: next, currentBook });
  },

  updateFolder: (id, updates) => {
    const next: Library = {
      ...latestLibrary,
      folders: latestLibrary.folders.map((folder) => (folder.id === id ? { ...folder, ...updates } : folder)),
      lastUpdated: Date.now(),
    };
    syncLibrary(next);
    set({ library: next });
  },

  setBookFolder: (bookId, folderId) => {
    const next: Library = {
      ...latestLibrary,
      books: latestLibrary.books.map((b) => (b.id === bookId ? { ...b, folderId } : b)),
      lastUpdated: Date.now(),
    };
    syncLibrary(next);
    const currentBook =
      latestCurrentBook?.id === bookId ? { ...latestCurrentBook, folderId } : latestCurrentBook;
    syncCurrentBook(currentBook);
    set({ library: next, currentBook });
  },

  currentBook: null,
  replaceCurrentBookSnapshot: (book) => {
    syncCurrentBook(book);
    set({ currentBook: book });
  },
  setCurrentBook: (book) => {
    syncCurrentBook(book);
    set({ currentBook: book });
  },
}));
