const DB_NAME = 'creader';
const DB_VERSION = 5;

export const STORES = {
  covers: 'covers',
  locations: 'locations',
  chatMessages: 'chatMessages',
  conversationMemory: 'conversationMemory',
} as const;

const OBSOLETE_STORES = ['searchText', 'searchResults'];

let dbPromise: Promise<IDBDatabase> | null = null;

export function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of OBSOLETE_STORES) {
        if (db.objectStoreNames.contains(name)) {
          db.deleteObjectStore(name);
        }
      }
      for (const name of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}
