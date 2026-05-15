import { getDb } from './Db';

export function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | null> {
  const db = await getDb();
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  const result = (await requestToPromise(store.get(key))) as T | undefined;
  await txDone(tx);
  return result ?? null;
}

export async function idbPut<T>(storeName: string, key: IDBValidKey, value: T): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  store.put(value as any, key);
  await txDone(tx);
}

export async function idbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  store.delete(key);
  await txDone(tx);
}

export async function idbClear(storeName: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  store.clear();
  await txDone(tx);
}

export async function withTx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore, tx: IDBTransaction) => Promise<T> | T
): Promise<T> {
  const db = await getDb();
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  try {
    const result = await fn(store, tx);
    await txDone(tx);
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
    }
    throw error;
  }
}
