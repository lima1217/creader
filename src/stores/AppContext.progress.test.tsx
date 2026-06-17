import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import type { Book, Library } from '../types';
import { AppProvider, useLibrary, useBookProgress } from './AppContext';
import { STORAGE_KEYS } from '../services/LocalStore';

type Combined = ReturnType<typeof useLibrary> & ReturnType<typeof useBookProgress>;

function Snapshotter({ onSnapshot }: { onSnapshot: (snap: Combined) => void }) {
  const lib = useLibrary();
  const progress = useBookProgress();
  useEffect(() => {
    onSnapshot({ ...lib, ...progress });
  }, [lib, progress, onSnapshot]);
  return null;
}

// React 19 removed the `act` export and `react-dom/test-utils` is broken on
// this version, so we drive the concurrent root with flushSync + microtask
// settling to flush effects and state reliably.
async function settle() {
  for (let i = 0; i < 4; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

describe('AppProvider setCurrentBook', () => {
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
      })
    );

    let latest: Combined | null = null;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <AppProvider>
          <Snapshotter onSnapshot={(snap) => (latest = snap)} />
        </AppProvider>
      );
    });
    await settle();

    expect(latest).not.toBeNull();
    expect(latest!.library.books[0].progress.currentCfi).toBe('');

    flushSync(() => {
      latest!.setCurrentBook(latest!.library.books[0]);
    });
    await settle();

    expect(latest!.currentBook?.progress.currentCfi).toBe('epubcfi(/6/2[chap]!/4/2/14)');
    expect(latest!.currentBook?.progress.percentage).toBe(55);

    root.unmount();
    await settle();
    container.remove();
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

    let latest: Combined | null = null;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <AppProvider>
          <Snapshotter onSnapshot={(snap) => (latest = snap)} />
        </AppProvider>
      );
    });
    await settle();

    flushSync(() => {
      latest!.setCurrentBook(latest!.library.books[0]);
    });
    await settle();

    // Opening the book should write a fresh lastReadAt into the progress map,
    // even though the book had no prior progress entry and the user hasn't
    // turned a page. This is what keeps frequently-opened books near the top
    // of the sidebar.
    expect(latest!.bookProgressById[book.id]?.lastReadAt).toBe(now);

    vi.restoreAllMocks();

    root.unmount();
    await settle();
    container.remove();
  });
});
