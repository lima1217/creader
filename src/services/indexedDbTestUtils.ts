import 'fake-indexeddb/auto';
import { DB_NAME, deleteCReaderDbForTests } from './DexieDb';

export async function resetIndexedDb(): Promise<void> {
  await deleteCReaderDbForTests();
  localStorage.clear();
}

export async function seedRawIndexedDb(
  version: number,
  records: Partial<Record<string, Array<{ key: IDBValidKey; value: unknown }>>>
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ['covers', 'chatMessages', 'conversationMemory']) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const storeNames = Object.keys(records);
      if (storeNames.length === 0) {
        db.close();
        resolve();
        return;
      }

      const tx = db.transaction(storeNames, 'readwrite');
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };

      for (const [storeName, entries] of Object.entries(records)) {
        const store = tx.objectStore(storeName);
        for (const entry of entries ?? []) {
          store.put(entry.value, entry.key);
        }
      }
    };
  });
}
