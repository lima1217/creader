const DB_NAME = 'creader';
const DB_VERSION = 1;
const STORE_NAME = 'covers';

let dbPromise: Promise<IDBDatabase> | null = null;
const urlCache = new Map<string, string>();

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

export async function saveCover(bookId: string, blob: Blob): Promise<void> {
  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(blob, bookId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function loadCover(bookId: string): Promise<Blob | null> {
  const db = await getDb();
  return await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(bookId);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCover(bookId: string): Promise<void> {
  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(bookId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getCoverUrl(bookId: string): Promise<string | null> {
  const cached = urlCache.get(bookId);
  if (cached) return cached;

  const blob = await loadCover(bookId);
  if (!blob) return null;

  const url = URL.createObjectURL(blob);
  urlCache.set(bookId, url);
  return url;
}

export function revokeCoverUrl(bookId: string): void {
  const url = urlCache.get(bookId);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(bookId);
  }
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}
