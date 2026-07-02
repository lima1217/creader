import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteCover, loadCover, saveCover } from './CoverStore';
import { resetIndexedDb, seedRawIndexedDb } from './indexedDbTestUtils';

describe('CoverStore Dexie persistence', () => {
  beforeEach(async () => {
    await resetIndexedDb();
  });

  it('saves, hydrates, and deletes covers through Dexie', async () => {
    await saveCover('book-1', new Blob(['cover-data'], { type: 'text/plain' }));

    expect(await loadCover('book-1')).not.toBeNull();

    await deleteCover('book-1');
    await expect(loadCover('book-1')).resolves.toBeNull();
  });

  it('loads covers written by the previous raw IndexedDB store', async () => {
    await seedRawIndexedDb(5, {
      covers: [{ key: 'book-legacy', value: new Blob(['legacy-cover'], { type: 'text/plain' }) }],
    });

    expect(await loadCover('book-legacy')).not.toBeNull();
  });
});
