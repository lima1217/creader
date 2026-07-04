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

    const library: Library = { books: [book], folders: [], lastUpdated: 1 };
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

    const library: Library = { books: [book], folders: [], lastUpdated: 1 };
    localStorage.setItem(STORAGE_KEYS.library, JSON.stringify({ v: 1, data: library }));

    const { useLibraryStore, useProgressStore } = await loadFreshStores();

    useLibraryStore.getState().addBook({ ...book, id: 'b2' });
    expect(useProgressStore.getState().bookProgressById.b2).toBeUndefined();

    useProgressStore.getState().setEntry(book.id, { currentCfi: '', percentage: 0, lastReadAt: 1 });
    useLibraryStore.getState().removeBook(book.id);
    expect(useProgressStore.getState().bookProgressById[book.id]?.lastReadAt).toBe(1);

    vi.restoreAllMocks();
  });

  it('hydrates old categories as folders and migrates book membership without colors', async () => {
    const legacyBook: Book = {
      id: 'b1',
      title: 'Legacy Book',
      author: 'Author',
      filePath: '/tmp/book.epub',
      addedAt: 1,
      progress: { currentCfi: '', percentage: 0 },
      categoryId: 'cat1',
    };
    localStorage.setItem(
      STORAGE_KEYS.library,
      JSON.stringify({
        v: 1,
        data: {
          books: [legacyBook],
          categories: [{ id: 'cat1', name: 'Reading', color: '#ff0000', createdAt: 2 }],
          lastUpdated: 3,
        },
      }),
    );

    const { useLibraryStore } = await loadFreshStores();

    expect(useLibraryStore.getState().library).toEqual({
      books: [{
        id: 'b1',
        title: 'Legacy Book',
        author: 'Author',
        filePath: '/tmp/book.epub',
        addedAt: 1,
        progress: { currentCfi: '', percentage: 0 },
        folderId: 'cat1',
      }],
      folders: [{ id: 'cat1', name: 'Reading', sortOrder: 0, createdAt: 2 }],
      lastUpdated: 3,
    });
    expect('color' in useLibraryStore.getState().library.folders[0]).toBe(false);
  });

  it('creates folder membership and clears books to unfiled when a folder is deleted', async () => {
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
    localStorage.setItem(
      STORAGE_KEYS.library,
      JSON.stringify({ v: 1, data: { books: [book], folders: [], lastUpdated: 1 } }),
    );

    const { useLibraryStore } = await loadFreshStores();

    const folder = useLibraryStore.getState().addFolder('Reading');
    expect(folder).toEqual({ id: `${now}`, name: 'Reading', sortOrder: 0, createdAt: now });
    expect(useLibraryStore.getState().library.categories).toBeUndefined();

    useLibraryStore.getState().setBookFolder(book.id, folder!.id);
    expect(useLibraryStore.getState().library.books[0].folderId).toBe(folder!.id);
    expect(useLibraryStore.getState().library.books[0].categoryId).toBeUndefined();

    useLibraryStore.getState().removeFolder(folder!.id);
    expect(useLibraryStore.getState().library.books[0].folderId).toBeUndefined();
    expect(useLibraryStore.getState().library.folders).toHaveLength(0);

    vi.restoreAllMocks();
  });

  it('reorders folders by rewriting persisted sortOrder only', async () => {
    const folderA = { id: 'folder-a', name: 'Alpha', sortOrder: 0, createdAt: 1 };
    const folderB = { id: 'folder-b', name: 'Beta', sortOrder: 1, createdAt: 2 };
    const folderC = { id: 'folder-c', name: 'Gamma', sortOrder: 2, createdAt: 3 };
    const book: Book = {
      id: 'b1',
      title: 'Book',
      author: 'Author',
      filePath: '/tmp/book.epub',
      addedAt: 1,
      progress: { currentCfi: '', percentage: 0 },
      folderId: 'folder-b',
    };
    localStorage.setItem(
      STORAGE_KEYS.library,
      JSON.stringify({
        v: 1,
        data: { books: [book], folders: [folderA, folderB, folderC], lastUpdated: 1 },
      }),
    );

    const { useLibraryStore } = await loadFreshStores();

    useLibraryStore.getState().reorderFolder('folder-c', 'folder-a');

    expect(useLibraryStore.getState().library.folders.map(folder => [folder.id, folder.sortOrder])).toEqual([
      ['folder-c', 0],
      ['folder-a', 1],
      ['folder-b', 2],
    ]);
    expect(useLibraryStore.getState().library.books[0].folderId).toBe('folder-b');
  });

  it('renames a folder with trimmed persisted name and lastUpdated', async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const folder = { id: 'folder1', name: 'Reading', sortOrder: 0, createdAt: 1 };
    localStorage.setItem(
      STORAGE_KEYS.library,
      JSON.stringify({ v: 1, data: { books: [], folders: [folder], lastUpdated: 1 } }),
    );

    const { useLibraryStore } = await loadFreshStores();

    useLibraryStore.getState().updateFolder('folder1', { name: '  Deep Work  ' });
    expect(useLibraryStore.getState().library.folders[0]).toEqual({
      id: 'folder1',
      name: 'Deep Work',
      sortOrder: 0,
      createdAt: 1,
    });
    expect(useLibraryStore.getState().library.lastUpdated).toBe(now);

    vi.restoreAllMocks();
  });

  it('rejects duplicate folder names and empty names at the store boundary', async () => {
    const folder = { id: 'folder1', name: 'Reading', sortOrder: 0, createdAt: 1 };
    localStorage.setItem(
      STORAGE_KEYS.library,
      JSON.stringify({ v: 1, data: { books: [], folders: [folder], lastUpdated: 1 } }),
    );

    const { useLibraryStore } = await loadFreshStores();

    expect(useLibraryStore.getState().addFolder('reading')).toBeNull();
    expect(useLibraryStore.getState().addFolder('   ')).toBeNull();
    useLibraryStore.getState().updateFolder('folder1', { name: 'reading' });
    expect(useLibraryStore.getState().library.folders[0].name).toBe('Reading');
  });

  it('syncs currentBook folderId when moving or deleting folders', async () => {
    const book: Book = {
      id: 'b1',
      title: 'Book',
      author: 'Author',
      filePath: '/tmp/book.epub',
      addedAt: 1,
      progress: { currentCfi: '', percentage: 0 },
    };
    localStorage.setItem(
      STORAGE_KEYS.library,
      JSON.stringify({ v: 1, data: { books: [book], folders: [], lastUpdated: 1 } }),
    );

    const { useLibraryStore } = await loadFreshStores();
    const folder = useLibraryStore.getState().addFolder('Reading');
    expect(folder).not.toBeNull();
    useLibraryStore.getState().setCurrentBook({ ...book, folderId: folder!.id });
    useLibraryStore.getState().setBookFolder(book.id, folder!.id);

    expect(useLibraryStore.getState().currentBook?.folderId).toBe(folder!.id);

    useLibraryStore.getState().removeFolder(folder!.id);
    expect(useLibraryStore.getState().currentBook?.folderId).toBeUndefined();
  });

  it('ignores setBookFolder when the target folder does not exist', async () => {
    const book: Book = {
      id: 'b1',
      title: 'Book',
      author: 'Author',
      filePath: '/tmp/book.epub',
      addedAt: 1,
      progress: { currentCfi: '', percentage: 0 },
    };
    localStorage.setItem(
      STORAGE_KEYS.library,
      JSON.stringify({ v: 1, data: { books: [book], folders: [], lastUpdated: 1 } }),
    );

    const { useLibraryStore } = await loadFreshStores();
    useLibraryStore.getState().setBookFolder(book.id, 'missing-folder');
    expect(useLibraryStore.getState().library.books[0].folderId).toBeUndefined();
  });
});
