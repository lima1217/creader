import { create } from 'zustand';
import type { Book, BookCategory, Library, SearchIndexSummary } from '../types';
import { deleteCover, revokeCoverUrl } from '../services/CoverStore';
import { getInitialLibrary } from './app/initialState';
import { useProgressStore } from './progressStore';
import { createLogger } from '../utils/logger';

const logger = createLogger('libraryStore');

/**
 * Library + current book (issue #13), persisted via debounced localStorage.
 *
 * Book/category mutators carry the same side effects they had inside the old
 * `AppProvider`:
 *   - `addBook` / `removeBook` / `setCurrentBook` also touch the progress map
 *     in {@link useProgressStore};
 *   - `removeBook` revokes the cover URL, deletes the stored cover blob, and
 *     invokes the Rust `delete_book_file` command for books that live in the
 *     app's books directory;
 *   - `setCurrentBook` bumps `lastReadAt` and merges any stored progress so
 *     the reader resumes at the right spot.
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
  setCurrentBook: (book: Book | null) => void;
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
    useProgressStore.getState().setEntry(book.id, {
      ...book.progress,
      lastReadAt: book.lastReadAt ?? 0,
    });
  },

  removeBook: (id) => {
    const book = latestLibrary.books.find((b) => b.id === id);

    void deleteCover(id);
    revokeCoverUrl(id);
    useProgressStore.getState().removeEntry(id);

    // Delete the book file if it's in the app's books directory.
    if (book?.filePath) {
      import('@tauri-apps/api/core')
        .then(({ invoke }) => {
          invoke('delete_book_file', { filePath: book.filePath }).catch((err) =>
            logger.warn('Failed to delete book file:', err),
          );
        })
        .catch(() => {
          // Not running in Tauri environment
        });
    }

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
  setCurrentBook: (book) => {
    if (!book) {
      syncCurrentBook(null);
      set({ currentBook: null });
      return;
    }

    // Opening a book marks it as recently read, so the sidebar ordering
    // (by lastReadAt) keeps frequently-opened books near the top even
    // when the user hasn't turned a page yet. Merge any stored progress
    // (cfi/percentage) so the reader resumes at the right spot.
    const now = Date.now();
    const progressStore = useProgressStore.getState();
    // Snapshot the entry as it was *before* this open, mirroring the original
    // `setCurrentBook` which read the closure-captured (pre-update) value.
    const storedProgress = progressStore.bookProgressById[book.id];
    const existing = progressStore.bookProgressById[book.id];
    progressStore.setEntry(book.id, existing ? { ...existing, lastReadAt: now } : { ...book.progress, lastReadAt: now });

    const progress = storedProgress
      ? {
          ...book.progress,
          currentCfi: storedProgress.currentCfi,
          percentage: storedProgress.percentage,
        }
      : book.progress;

    const nextBook: Book = { ...book, progress, lastReadAt: now };
    syncCurrentBook(nextBook);
    set({ currentBook: nextBook });
  },
}));
