import { describe, expect, it } from 'vitest';
import { normalizeLibrary } from './libraryNormalization';

describe('normalizeLibrary', () => {
  it('prefers folderId over legacy categoryId when both exist', () => {
    const result = normalizeLibrary({
      books: [{
        id: 'b1',
        title: 'Book',
        folderId: 'folder-new',
        categoryId: 'cat-old',
      }],
      folders: [{ id: 'folder-new', name: 'New', sortOrder: 0, createdAt: 1 }],
      categories: [{ id: 'cat-old', name: 'Old', color: '#000', createdAt: 2 }],
      lastUpdated: 3,
    });

    expect(result.books[0].folderId).toBe('folder-new');
    expect(result.books[0]).not.toHaveProperty('categoryId');
  });

  it('strips orphan folderId when the folder no longer exists', () => {
    const result = normalizeLibrary({
      books: [{ id: 'b1', title: 'Book', folderId: 'missing-folder' }],
      folders: [],
      lastUpdated: 1,
    });

    expect(result.books[0].folderId).toBeUndefined();
  });

  it('hydrates legacy categories when folders are absent', () => {
    const result = normalizeLibrary({
      books: [{ id: 'b1', title: 'Book', categoryId: 'cat1' }],
      categories: [{ id: 'cat1', name: 'Reading', color: '#f00', createdAt: 2 }],
      lastUpdated: 3,
    });

    expect(result.folders).toEqual([{ id: 'cat1', name: 'Reading', sortOrder: 0, createdAt: 2 }]);
    expect(result.books[0].folderId).toBe('cat1');
  });

  it('filters invalid folder entries missing id or name', () => {
    const result = normalizeLibrary({
      books: [],
      folders: [
        { id: 'ok', name: 'Valid', sortOrder: 0, createdAt: 1 },
        { id: '', name: 'Missing Id', sortOrder: 1, createdAt: 2 },
        { id: 'missing-name', name: '', sortOrder: 2, createdAt: 3 },
      ],
      lastUpdated: 4,
    });

    expect(result.folders).toEqual([{ id: 'ok', name: 'Valid', sortOrder: 0, createdAt: 1 }]);
  });

  it('strips inline cover when coverKey is already present', () => {
    const result = normalizeLibrary({
      books: [{
        id: 'b1',
        title: 'Book',
        cover: 'data:image/png;base64,abc',
        coverKey: 'b1',
      }],
      folders: [],
      lastUpdated: 1,
    });

    expect(result.books[0].coverKey).toBe('b1');
    expect(result.books[0].cover).toBeUndefined();
  });
});
