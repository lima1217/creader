import { describe, expect, it } from 'vitest';
import type { Book, BookFolder } from '../types';
import {
  buildVisibleGroups,
  matchesBookSearch,
  orderBooks,
  resolveInitialExpandedFolderIds,
} from './libraryOrganizer';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'b1',
    title: 'A Book',
    author: 'An Author',
    filePath: '/tmp/book.epub',
    addedAt: 1,
    progress: { currentCfi: '', percentage: 0 },
    ...overrides,
  };
}

function makeFolder(overrides: Partial<BookFolder> = {}): BookFolder {
  return { id: 'folder1', name: 'Reading', sortOrder: 0, createdAt: 1, ...overrides };
}

describe('libraryOrganizer', () => {
  it('orders books by recent activity and keeps the current book first', () => {
    const books = [
      makeBook({ id: 'b1', title: 'Older', lastReadAt: 1 }),
      makeBook({ id: 'b2', title: 'Recent', lastReadAt: 99 }),
    ];
    const current = books[0];

    expect(orderBooks(books, current, {}).map(book => book.id)).toEqual(['b1', 'b2']);
  });

  it('matches title and author search queries', () => {
    const book = makeBook({ title: 'Deep Work', author: 'Cal Newport' });
    expect(matchesBookSearch(book, 'deep')).toBe(true);
    expect(matchesBookSearch(book, 'newport')).toBe(true);
    expect(matchesBookSearch(book, 'missing')).toBe(false);
  });

  it('builds search-scoped visible groups without empty folders', () => {
    const folderA = makeFolder({ id: 'folder-a', name: 'Theory' });
    const folderB = makeFolder({ id: 'folder-b', name: 'Practice' });
    const groups = buildVisibleGroups({
      folders: [folderA, folderB],
      groupedBooks: {
        unfiled: [],
        'folder-a': [makeBook({ id: 'b1', title: 'Deep Work' })],
        'folder-b': [makeBook({ id: 'b2', title: 'Ship It' })],
      },
      selectedView: 'all',
      bookSearchQuery: 'deep',
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Theory');
    expect(groups[0].books).toHaveLength(1);
  });

  it('expands the current book folder on first load when no persisted state exists', () => {
    const folder = makeFolder({ id: 'folder1' });
    const current = makeBook({ id: 'b1', folderId: 'folder1' });

    expect(resolveInitialExpandedFolderIds({
      folders: [folder],
      books: [current],
      currentBook: current,
      bookProgressById: {},
    })).toEqual(['folder1']);
  });

  it('falls back to the most recently read folder when there is no current book', () => {
    const folderA = makeFolder({ id: 'folder-a', sortOrder: 0 });
    const folderB = makeFolder({ id: 'folder-b', sortOrder: 1 });
    const books = [
      makeBook({ id: 'b1', folderId: 'folder-a' }),
      makeBook({ id: 'b2', folderId: 'folder-b' }),
    ];

    expect(resolveInitialExpandedFolderIds({
      folders: [folderA, folderB],
      books,
      currentBook: null,
      bookProgressById: {
        'b2': { lastReadAt: 99 },
      },
    })).toEqual(['folder-b']);
  });
});
