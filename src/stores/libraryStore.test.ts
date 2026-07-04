import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book, Library } from '../types';
import { STORAGE_KEYS } from '../services/LocalStore';

/**
 * Progress / currentBook semantics, ported from the old AppProvider-based test.
 *
 * The Zustand stores are module singletons that hydrate once from localStorage
 * at import time. To exercise hydration for each scenario we re-import the
 * store modules fresh (vi.resetModules + dynamic import) after seeding
 * localStorage, so each test starts from a clean, hydrated state.
 */
async function loadFreshStores() {
  vi.resetModules();
  const libraryModule = await import('./libraryStore');
  const progressModule = await import('./progressStore');
  return {
    useLibraryStore: libraryModule.useLibraryStore,
    useProgressStore: progressModule.useProgressStore,
    getLatestLibrary: libraryModule.getLatestLibrary,
  } as const;
}

describe('libraryStore pure state transitions', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('sets currentBook without reading the progress store', async () => {
    const book: Book = {
      id: 'b1',
      title: 'Book',
      author: 'Author',
      filePath: '/tmp/book.epub',
      addedAt: 1,
      progress: { currentCfi: '', percentage: 0 },
    };

    const library: Library = { books: [book], categories: [], lastUpdated: 1 };
    localStorage.setItem(STORAGE_KEYS.library, JSON.stringify({ v: 1, data: library }));
    localStorage.setItem(
      STORAGE_KEYS.progress,
      JSON.stringify({
        v: 1,
        data: {
          [book.id]: { currentCfi: 'epubcfi(/6/2[chap]!/4/2/14)', percentage: 55, lastReadAt: 123 },
        },
      }),
    );

    const { useLibraryStore, useProgressStore } = await loadFreshStores();

    expect(useLibraryStore.getState().library.books[0].progress.currentCfi).toBe('');
    // The stored progress map hydrated independently into the progress store.
    expect(useProgressStore.getState().bookProgressById[book.id].percentage).toBe(55);

    useLibraryStore.getState().setCurrentBook(useLibraryStore.getState().library.books[0]);

    expect(useLibraryStore.getState().currentBook?.progress.currentCfi).toBe('');
    expect(useLibraryStore.getState().currentBook?.progress.percentage).toBe(0);
  });

  it('adds and removes books without mutating the progress store', async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const book: Book = {
      id: 'b1',
      title: 'Book',
      author: 'Author',
      filePath: '/tmp/book.epub',
      addedAt: 1,
      progress: { currentCfi: '', percentage: 0 },
    };

    const library: Library = { books: [book], categories: [], lastUpdated: 1 };
    localStorage.setItem(STORAGE_KEYS.library, JSON.stringify({ v: 1, data: library }));

    const { useLibraryStore, useProgressStore } = await loadFreshStores();

    useLibraryStore.getState().addBook({ ...book, id: 'b2' });
    expect(useProgressStore.getState().bookProgressById.b2).toBeUndefined();

    useProgressStore.getState().setEntry(book.id, { currentCfi: '', percentage: 0, lastReadAt: 1 });
    useLibraryStore.getState().removeBook(book.id);
    expect(useProgressStore.getState().bookProgressById[book.id]?.lastReadAt).toBe(1);

    vi.restoreAllMocks();
  });
});
