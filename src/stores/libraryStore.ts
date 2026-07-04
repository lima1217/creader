import { create } from 'zustand';
import type { Book, BookCategory, Library, SearchIndexSummary } from '../types';
import { getInitialLibrary } from './app/initialState';

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
  updateBook: (id: string, updates: Partial<Pick<Book, 'title' | 'author' | 'categoryId'>>) => void;
  updateBookFilePath: (id: string, newFilePath: string) => void;
  updateBookSearchIndex: (id: string, searchIndex: SearchIndexSummary) => void;
  addCategory: (name: string, color: string) => BookCategory;
  removeCategory: (id: string) => void;
  updateCategory: (id: string, updates: Partial<Pick<BookCategory, 'name' | 'color'>>) => void;
  setBookCategory: (bookId: string, categoryId: string | undefined) => void;
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
    syncLibrary(library);
    set({ library });
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

  addCategory: (name, color) => {
    const newCategory: BookCategory = {
      id: Date.now().toString(),
      name,
      color,
      createdAt: Date.now(),
    };
    const next: Library = {
      ...latestLibrary,
      categories: [...(latestLibrary.categories || []), newCategory],
      lastUpdated: Date.now(),
    };
    syncLibrary(next);
    set({ library: next });
    return newCategory;
  },

  removeCategory: (id) => {
    const next: Library = {
      ...latestLibrary,
      categories: (latestLibrary.categories || []).filter((c) => c.id !== id),
      // Also remove category assignment from books
      books: latestLibrary.books.map((b) =>
        b.categoryId === id ? { ...b, categoryId: undefined } : b,
      ),
      lastUpdated: Date.now(),
    };
    syncLibrary(next);
    set({ library: next });
  },

  updateCategory: (id, updates) => {
    const next: Library = {
      ...latestLibrary,
      categories: (latestLibrary.categories || []).map((c) => (c.id === id ? { ...c, ...updates } : c)),
      lastUpdated: Date.now(),
    };
    syncLibrary(next);
    set({ library: next });
  },

  setBookCategory: (bookId, categoryId) => {
    const next: Library = {
      ...latestLibrary,
      books: latestLibrary.books.map((b) => (b.id === bookId ? { ...b, categoryId } : b)),
      lastUpdated: Date.now(),
    };
    syncLibrary(next);
    set({ library: next });
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
