import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EpubBookLike } from './epubAdapter';
import { db } from '../DexieDb';
import { generateAndPersistLocations, loadLocationsIfAvailable } from './locationsCache';
import { resetIndexedDb, seedRawIndexedDb } from '../indexedDbTestUtils';

function bookWithLocations(serialized = 'generated-locations'): EpubBookLike {
  return {
    locations: {
      load: vi.fn().mockResolvedValue(undefined),
      generate: vi.fn().mockResolvedValue(undefined),
      save: vi.fn(() => serialized),
      length: vi.fn(() => 0),
    },
  } as unknown as EpubBookLike;
}

describe('locationsCache Dexie persistence', () => {
  beforeEach(async () => {
    await resetIndexedDb();
  });

  it('loads locations written by the previous raw IndexedDB store', async () => {
    const book = bookWithLocations();
    await seedRawIndexedDb(5, {
      locations: [{ key: 'locations:book-1', value: 'legacy-idb-locations' }],
    });

    await expect(loadLocationsIfAvailable(book, 'book-1')).resolves.toBe(true);
    expect(book.locations?.load).toHaveBeenCalledWith('legacy-idb-locations');
  });

  it('keeps localStorage compatibility for older location caches', async () => {
    const book = bookWithLocations();
    localStorage.setItem('creader-locations:book-2', 'legacy-local-locations');

    await expect(loadLocationsIfAvailable(book, 'book-2')).resolves.toBe(true);
    expect(book.locations?.load).toHaveBeenCalledWith('legacy-local-locations');
    expect(localStorage.getItem('creader-locations:book-2')).toBeNull();
  });

  it('generates and persists locations through Dexie', async () => {
    const book = bookWithLocations('new-locations');
    localStorage.setItem('creader-locations:book-3', 'old-local-locations');

    await expect(generateAndPersistLocations(book, 'book-3')).resolves.toBe(true);

    expect(book.locations?.generate).toHaveBeenCalledWith(1600);
    await expect(db.locations.get('locations:book-3')).resolves.toBe('new-locations');
    expect(localStorage.getItem('creader-locations:book-3')).toBeNull();
  });
});
