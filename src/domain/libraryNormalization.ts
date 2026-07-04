import type { BookFolder, Library } from '../types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function normalizeFolders(rawLibrary: unknown): BookFolder[] {
  const library = asRecord(rawLibrary);
  const rawFolders = Array.isArray(library.folders) ? library.folders : [];
  if (rawFolders.length > 0) {
    return rawFolders
      .map((raw, index) => {
        const folder = asRecord(raw);
        const id = typeof folder.id === 'string' ? folder.id : '';
        const name = typeof folder.name === 'string' ? folder.name : '';
        if (!id || !name) return null;
        return {
          id,
          name,
          sortOrder: typeof folder.sortOrder === 'number' ? folder.sortOrder : index,
          createdAt: typeof folder.createdAt === 'number' ? folder.createdAt : 0,
        };
      })
      .filter((folder): folder is BookFolder => folder !== null);
  }

  const rawCategories = Array.isArray(library.categories) ? library.categories : [];
  return rawCategories
    .map((raw, index) => {
      const category = asRecord(raw);
      const id = typeof category.id === 'string' ? category.id : '';
      const name = typeof category.name === 'string' ? category.name : '';
      if (!id || !name) return null;
      return {
        id,
        name,
        sortOrder: index,
        createdAt: typeof category.createdAt === 'number' ? category.createdAt : 0,
      };
    })
    .filter((folder): folder is BookFolder => folder !== null);
}

export function normalizeLibrary(rawLibrary: unknown, now: () => number = Date.now): Library {
  const library = asRecord(rawLibrary);
  const folders = normalizeFolders(rawLibrary);
  const folderIds = new Set(folders.map(folder => folder.id));
  const rawBooks = Array.isArray(library.books) ? library.books : [];
  const books = rawBooks.map(raw => {
    const book = asRecord(raw);
    const { categoryId: _categoryId, folderId: _rawFolderId, ...rest } = book;
    const folderId = typeof book.folderId === 'string'
      ? book.folderId
      : typeof _categoryId === 'string'
        ? _categoryId
        : undefined;
    return {
      ...rest,
      ...(folderId && folderIds.has(folderId) ? { folderId } : {}),
    };
  }) as Library['books'];

  return {
    books,
    folders,
    lastUpdated: typeof library.lastUpdated === 'number' ? library.lastUpdated : now(),
  };
}
