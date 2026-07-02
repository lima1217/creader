import type { EpubBookLike } from './epubAdapter';
import { db } from '../DexieDb';

export async function loadLocationsIfAvailable(book: EpubBookLike, bookId: string): Promise<boolean> {
  if (!book?.locations) return false;

  const key = `locations:${bookId}`;
  const legacyKey = `creader-locations:${bookId}`;

  const saved = await db.locations.get(key) ?? null;

  const legacy = !saved ? localStorage.getItem(legacyKey) : null;
  const toLoad = saved ?? legacy;

  if (toLoad && typeof book.locations.load === 'function') {
    await book.locations.load(toLoad);
    if (legacy) localStorage.removeItem(legacyKey);
    return true;
  }

  return false;
}

export async function generateAndPersistLocations(book: EpubBookLike, bookId: string): Promise<boolean> {
  if (!book?.locations) return false;

  const key = `locations:${bookId}`;
  const legacyKey = `creader-locations:${bookId}`;

  if (typeof book.locations.generate !== 'function') return false;

  try {
    if (typeof book.locations.length === 'function' && book.locations.length() > 0) {
      return true;
    }
  } catch {
  }

  await book.locations.generate(1600);

  if (typeof book.locations.save !== 'function') return false;
  const serialized = book.locations.save();
  if (typeof serialized === 'string' && serialized.length > 0) {
    await db.locations.put(serialized, key);
    localStorage.removeItem(legacyKey);
    return true;
  }

  return false;
}
