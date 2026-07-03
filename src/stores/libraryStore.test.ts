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

describe('libraryStore / progressStore setCurrentBook', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('hydrates currentBook progress from stored progress map', async () => {
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

    expect(useLibraryStore.getState().currentBook?.progress.currentCfi).toBe('epubcfi(/6/2[chap]!/4/2/14)');
    expect(useLibraryStore.getState().currentBook?.progress.percentage).toBe(55);
  });

  it('marks the opened book as recently read (bumps lastReadAt)', async () => {
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

    useLibraryStore.getState().setCurrentBook(useLibraryStore.getState().library.books[0]);

    // Opening the book should write a fresh lastReadAt into the progress map,
    // even though the book had no prior progress entry and the user hasn't
    // turned a page. This is what keeps frequently-opened books near the top
    // of the sidebar.
    expect(useProgressStore.getState().bookProgressById[book.id]?.lastReadAt).toBe(now);

    vi.restoreAllMocks();
  });
});
