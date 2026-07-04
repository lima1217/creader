import type { Book, BookFolder } from '../types';

export type OrganizerView = 'all' | 'unfiled' | string;

export interface BookGroup {
  id: string;
  label: string;
  books: Book[];
  isFolder: boolean;
}

export function getBookActivity(
  book: Book,
  bookProgressById: Record<string, { lastReadAt?: number }>,
): number {
  return bookProgressById[book.id]?.lastReadAt ?? book.lastReadAt ?? 0;
}

export function orderBooks(
  books: Book[],
  currentBook: Book | null,
  bookProgressById: Record<string, { lastReadAt?: number }>,
): Book[] {
  const ordered = [...books].sort(
    (a, b) => getBookActivity(b, bookProgressById) - getBookActivity(a, bookProgressById),
  );
  const currentBookIndex = currentBook ? ordered.findIndex(book => book.id === currentBook.id) : -1;
  if (currentBookIndex <= 0) return ordered;

  const nextBooks = [...ordered];
  const [activeBook] = nextBooks.splice(currentBookIndex, 1);
  return [activeBook, ...nextBooks];
}

export function matchesBookSearch(book: Book, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return book.title.toLocaleLowerCase().includes(normalized)
    || (book.author || '').toLocaleLowerCase().includes(normalized);
}

export function groupBooksByFolder(
  orderedBooks: Book[],
  folders: BookFolder[],
): Record<string, Book[]> {
  const groups: Record<string, Book[]> = { unfiled: [] };
  folders.forEach(folder => {
    groups[folder.id] = [];
  });
  orderedBooks.forEach(book => {
    if (book.folderId && groups[book.folderId]) {
      groups[book.folderId].push(book);
    } else {
      groups.unfiled.push(book);
    }
  });
  return groups;
}

export function buildVisibleGroups(options: {
  folders: BookFolder[];
  groupedBooks: Record<string, Book[]>;
  selectedView: OrganizerView;
  bookSearchQuery: string;
}): BookGroup[] {
  const { folders, groupedBooks, selectedView, bookSearchQuery } = options;
  const hasSearch = bookSearchQuery.trim().length > 0;
  const allGroups: BookGroup[] = [
    { id: 'unfiled', label: '未归档', books: groupedBooks.unfiled || [], isFolder: false },
    ...folders.map(folder => ({
      id: folder.id,
      label: folder.name,
      books: groupedBooks[folder.id] || [],
      isFolder: true,
    })),
  ];

  const scopedGroups = selectedView === 'all'
    ? allGroups
    : allGroups.filter(group => group.id === selectedView);

  if (!hasSearch) return scopedGroups;

  return allGroups
    .map(group => ({
      ...group,
      books: group.books.filter(book => matchesBookSearch(book, bookSearchQuery)),
    }))
    .filter(group => group.books.length > 0);
}

export function resolveMostRecentFolderId(
  books: Book[],
  folders: BookFolder[],
  bookProgressById: Record<string, { lastReadAt?: number }>,
): string | undefined {
  const folderIds = new Set(folders.map(folder => folder.id));
  let bestFolderId: string | undefined;
  let bestActivity = -1;

  for (const book of books) {
    if (!book.folderId || !folderIds.has(book.folderId)) continue;
    const activity = getBookActivity(book, bookProgressById);
    if (activity > bestActivity) {
      bestActivity = activity;
      bestFolderId = book.folderId;
    }
  }

  return bestFolderId;
}

export function resolveInitialExpandedFolderIds(options: {
  folders: BookFolder[];
  books: Book[];
  currentBook: Book | null;
  bookProgressById: Record<string, { lastReadAt?: number }>;
}): string[] {
  const { folders, books, currentBook, bookProgressById } = options;
  const folderIds = new Set(folders.map(folder => folder.id));
  const currentFolderId = currentBook?.folderId;

  if (currentFolderId && folderIds.has(currentFolderId)) {
    return [currentFolderId];
  }

  const recentFolderId = resolveMostRecentFolderId(books, folders, bookProgressById);
  return recentFolderId ? [recentFolderId] : [];
}
