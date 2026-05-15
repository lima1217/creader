import { useEffect, act } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import type { Book, Library } from '../types';
import { AppProvider, useLibrary } from './AppContext';
import { STORAGE_KEYS } from '../services/LocalStore';

function Snapshotter({ onSnapshot }: { onSnapshot: (snap: ReturnType<typeof useLibrary>) => void }) {
  const lib = useLibrary();
  useEffect(() => {
    onSnapshot(lib);
  }, [lib, onSnapshot]);
  return null;
}

describe('AppProvider setCurrentBook', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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
      })
    );

    let latest: ReturnType<typeof useLibrary> | null = null;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AppProvider>
          <Snapshotter onSnapshot={(snap) => (latest = snap)} />
        </AppProvider>
      );
      await Promise.resolve();
    });

    expect(latest).not.toBeNull();
    expect(latest!.library.books[0].progress.currentCfi).toBe('');

    await act(async () => {
      latest!.setCurrentBook(latest!.library.books[0]);
      await Promise.resolve();
    });

    expect(latest!.currentBook?.progress.currentCfi).toBe('epubcfi(/6/2[chap]!/4/2/14)');
    expect(latest!.currentBook?.progress.percentage).toBe(55);
    expect(latest!.currentBook?.lastReadAt).toBe(123);

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    container.remove();
  });
});
