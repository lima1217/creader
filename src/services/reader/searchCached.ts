import type { ReaderSearchResult } from './types';
import type { EpubBookLike, EpubSpineItem } from './epubAdapter';
import { STORES } from '../Db';
import { idbGet, idbPut, requestToPromise, withTx } from '../idb';
import { SEARCH_TEXT_CACHE_MAX_ENTRIES, SEARCH_TEXT_CACHE_MAX_ENTRY_BYTES, SEARCH_TEXT_CACHE_MAX_TOTAL_BYTES } from '../../constants';

type CachedResults = {
  filePath: string;
  results: ReaderSearchResult[];
  createdAt: number;
};

type CachedText = {
  filePath: string;
  text: string;
  createdAt: number;
};

type SearchTextRecord = CachedText & {
  lastAccessAt: number;
  bytes: number;
};

type SearchTextMeta = {
  version: 1;
  totalBytes: number;
  entryCount: number;
  lastCleanupAt: number;
};

type WorkerStartMessage = {
  type: 'start';
  token: number;
  query: string;
  maxResults: number;
  maxPerSection: number;
  excerptRadius: number;
};

type WorkerSectionMessage = {
  type: 'section';
  token: number;
  cfiBase: string;
  section: string;
  text: string;
};

type WorkerFinishMessage = { type: 'finish'; token: number };
type WorkerCancelMessage = { type: 'cancel'; token: number };

type WorkerResultMessage = { type: 'result'; token: number; result: ReaderSearchResult };
type WorkerDoneMessage = { type: 'done'; token: number };
type WorkerOutMessage = WorkerResultMessage | WorkerDoneMessage;

let worker: Worker | null = null;
let workerSeq = 0;
const workerHandlers = new Map<number, (msg: WorkerOutMessage) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./searchWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<WorkerOutMessage>) => {
    const handler = workerHandlers.get(ev.data.token);
    if (handler) handler(ev.data);
  };
  return worker;
}

function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, ' ');
}

function searchResultsKey(bookId: string, filePath: string, query: string): string {
  return `results:${bookId}:${filePath}:${query.toLowerCase()}`;
}

function sectionTextKey(bookId: string, filePath: string, href: string): string {
  return `text:${bookId}:${filePath}:${href}`;
}

function sectionTextKeyV2(bookId: string, href: string): string {
  return `text2:${bookId}:${href}`;
}

const SEARCH_TEXT_META_KEY = '__meta__';

function estimateTextBytes(text: string): number {
  return text.length * 2;
}

const searchTextTouchAtByKey = new Map<string, number>();

async function maybeTouchSearchText(key: string, record: SearchTextRecord): Promise<void> {
  const now = Date.now();
  const lastTouched = searchTextTouchAtByKey.get(key) ?? 0;
  if (now - lastTouched < 2 * 60 * 1000) return;
  if (now - record.lastAccessAt < 10 * 60 * 1000) return;
  searchTextTouchAtByKey.set(key, now);

  await withTx(STORES.searchText, 'readwrite', async (store) => {
    store.put({ ...record, lastAccessAt: now }, key);
  });
}

async function getCachedSectionText(bookId: string, filePath: string, href: string): Promise<string> {
  const primaryKey = sectionTextKeyV2(bookId, href);
  const legacyKey = sectionTextKey(bookId, filePath, href);

  return await withTx(STORES.searchText, 'readwrite', async (store) => {
    const primary = (await requestToPromise(store.get(primaryKey))) as SearchTextRecord | CachedText | undefined;
    if (primary && (primary as any).filePath === filePath) {
      const rec = primary as SearchTextRecord;
      if (typeof rec.lastAccessAt === 'number' && typeof rec.bytes === 'number') {
        void maybeTouchSearchText(primaryKey, rec);
      } else {
        const upgraded: SearchTextRecord = {
          filePath,
          text: (primary as any).text ?? '',
          createdAt: (primary as any).createdAt ?? Date.now(),
          lastAccessAt: Date.now(),
          bytes: estimateTextBytes((primary as any).text ?? ''),
        };
        store.put(upgraded, primaryKey);
      }
      return (primary as any).text ?? '';
    }

    const legacy = (await requestToPromise(store.get(legacyKey))) as SearchTextRecord | CachedText | undefined;
    if (legacy && (legacy as any).filePath === filePath && typeof (legacy as any).text === 'string') {
      const now = Date.now();
      const upgraded: SearchTextRecord = {
        filePath,
        text: (legacy as any).text,
        createdAt: (legacy as any).createdAt ?? now,
        lastAccessAt: now,
        bytes: typeof (legacy as any).bytes === 'number' ? (legacy as any).bytes : estimateTextBytes((legacy as any).text),
      };
      store.put(upgraded, primaryKey);
      store.delete(legacyKey);
      return upgraded.text;
    }
    return '';
  });
}

type SearchTextEntryInfo = {
  key: string;
  lastAccessAt: number;
  bytes: number;
};

async function enforceSearchTextBudget(store: IDBObjectStore, existingMeta: SearchTextMeta | null): Promise<void> {
  const entries: SearchTextEntryInfo[] = [];

  await new Promise<void>((resolve, reject) => {
    const cursorReq = store.openCursor();
    cursorReq.onerror = () => reject(cursorReq.error);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return resolve();

      const key = String(cursor.key);
      if (key !== SEARCH_TEXT_META_KEY && (key.startsWith('text2:') || key.startsWith('text:'))) {
        const value = cursor.value as any;
        const bytes = typeof value?.bytes === 'number' ? value.bytes : estimateTextBytes(value?.text ?? '');
        const lastAccessAt = typeof value?.lastAccessAt === 'number' ? value.lastAccessAt : (typeof value?.createdAt === 'number' ? value.createdAt : 0);
        entries.push({ key, lastAccessAt, bytes });
      }
      cursor.continue();
    };
  });

  let totalBytes = 0;
  for (const e of entries) totalBytes += e.bytes;
  let entryCount = entries.length;

  const needEvict = totalBytes > SEARCH_TEXT_CACHE_MAX_TOTAL_BYTES || entryCount > SEARCH_TEXT_CACHE_MAX_ENTRIES;
  if (!needEvict) {
    const now = Date.now();
    const meta: SearchTextMeta = existingMeta ?? { version: 1, totalBytes, entryCount, lastCleanupAt: now };
    meta.totalBytes = totalBytes;
    meta.entryCount = entryCount;
    meta.lastCleanupAt = now;
    store.put(meta, SEARCH_TEXT_META_KEY);
    return;
  }

  entries.sort((a, b) => a.lastAccessAt - b.lastAccessAt);
  for (const e of entries) {
    if (totalBytes <= SEARCH_TEXT_CACHE_MAX_TOTAL_BYTES && entryCount <= SEARCH_TEXT_CACHE_MAX_ENTRIES) break;
    store.delete(e.key);
    totalBytes -= e.bytes;
    entryCount -= 1;
  }

  const now = Date.now();
  const meta: SearchTextMeta = { version: 1, totalBytes: Math.max(0, totalBytes), entryCount: Math.max(0, entryCount), lastCleanupAt: now };
  store.put(meta, SEARCH_TEXT_META_KEY);
}

async function putCachedSectionText(bookId: string, filePath: string, href: string, text: string): Promise<void> {
  const clean = text.trim();
  if (!clean) return;

  const bytes = estimateTextBytes(clean);
  if (bytes > SEARCH_TEXT_CACHE_MAX_ENTRY_BYTES) return;

  const key = sectionTextKeyV2(bookId, href);
  const legacyKey = sectionTextKey(bookId, filePath, href);

  await withTx(STORES.searchText, 'readwrite', async (store) => {
    const metaRaw = await requestToPromise(store.get(SEARCH_TEXT_META_KEY));
    const existingMeta = (metaRaw && (metaRaw as any).version === 1) ? (metaRaw as SearchTextMeta) : null;

    const now = Date.now();
    const record: SearchTextRecord = {
      filePath,
      text: clean,
      createdAt: now,
      lastAccessAt: now,
      bytes,
    };

    store.put(record, key);
    store.delete(legacyKey);

    const shouldCleanup =
      !existingMeta ||
      existingMeta.entryCount + 1 > SEARCH_TEXT_CACHE_MAX_ENTRIES ||
      existingMeta.totalBytes + bytes > SEARCH_TEXT_CACHE_MAX_TOTAL_BYTES ||
      now - existingMeta.lastCleanupAt > 10 * 60 * 1000;

    if (shouldCleanup) {
      await enforceSearchTextBudget(store, existingMeta);
    }
  });
}

function extractTextFromDocLike(doc: unknown): string {
  if (!doc) return '';
  if (typeof doc === 'string') {
    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(doc, 'text/html');
    return parsedDoc.body?.textContent || '';
  }
  if (doc instanceof Document) {
    return doc.body?.textContent || doc.documentElement?.textContent || '';
  }
  const anyDoc = doc as any;
  return anyDoc.body?.textContent || anyDoc.documentElement?.textContent || '';
}

async function loadSpineItemText(book: EpubBookLike, item: EpubSpineItem): Promise<string> {
  if (item.load) {
    try {
      const doc = await item.load(book.load?.bind(book));
      const text = extractTextFromDocLike(doc);
      if (text) return text;
    } catch {
    }
  }

  if (item.document) {
    const text = extractTextFromDocLike(item.document);
    if (text) return text;
  }

  const href = item.href || item.url;

  if (href && book.archive?.getText) {
    try {
      const content = await book.archive.getText(href);
      const text = extractTextFromDocLike(content);
      if (text) return text;
    } catch {
    }
  }

  if (href && book.archive?.request) {
    try {
      const content = await book.archive.request(href, 'text');
      const text = extractTextFromDocLike(content);
      if (text) return text;
    } catch {
    }
  }

  if (href && book.load) {
    try {
      const content = await book.load(href);
      const text = extractTextFromDocLike(content);
      if (text) return text;
    } catch {
    }
  }

  return '';
}

export async function searchBookCached(
  book: EpubBookLike,
  bookId: string,
  filePath: string,
  searchQuery: string,
  isCancelled: () => boolean
): Promise<ReaderSearchResult[]> {
  const query = normalizeQuery(searchQuery);
  if (!query) return [];

  const cached = await idbGet<CachedResults>(STORES.searchResults, searchResultsKey(bookId, filePath, query));
  if (cached && cached.filePath === filePath && cached.results && cached.results.length > 0) {
    return cached.results;
  }

  const spineItems = book.spine?.spineItems || book.spine?.items || [];
  if (spineItems.length === 0) return [];

  const token = ++workerSeq;
  const w = getWorker();

  const dedupe = new Set<string>();
  const results: ReaderSearchResult[] = [];
  let doneResolve: (() => void) | null = null;
  const donePromise = new Promise<void>(resolve => { doneResolve = resolve; });

  const handler = (msg: WorkerOutMessage) => {
    if (msg.type === 'done') {
      if (doneResolve) doneResolve();
      return;
    }
    const key = `${msg.result.cfi}::${msg.result.excerpt}`;
    if (dedupe.has(key)) return;
    dedupe.add(key);
    results.push(msg.result);
    if (results.length >= 50) {
      w.postMessage({ type: 'cancel', token } satisfies WorkerCancelMessage);
      if (doneResolve) doneResolve();
    }
  };

  workerHandlers.set(token, handler);
  w.postMessage({
    type: 'start',
    token,
    query,
    maxResults: 50,
    maxPerSection: 3,
    excerptRadius: 50,
  } satisfies WorkerStartMessage);

  try {
    for (let i = 0; i < spineItems.length; i++) {
      if (isCancelled()) {
        w.postMessage({ type: 'cancel', token } satisfies WorkerCancelMessage);
        break;
      }
      if (results.length >= 50) break;

      const item = spineItems[i];

      if (item.find) {
        try {
          const findResults = await item.find(query);
          if (findResults && findResults.length > 0) {
            for (const fr of findResults.slice(0, 3)) {
              if (results.length >= 50) break;
              const cfi = fr.cfi ?? item.href ?? item.url ?? `section_${i}`;
              const excerpt = fr.excerpt || query;
              const res: ReaderSearchResult = {
                cfi,
                excerpt,
                section: item.idref || item.label || `Chapter ${i + 1}`,
              };
              const key = `${res.cfi}::${res.excerpt}`;
              if (!dedupe.has(key)) {
                dedupe.add(key);
                results.push(res);
              }
            }
            continue;
          }
        } catch {
        }
      }

      const href = item.href || item.url || `section_${i}`;
      const section = item.idref || item.label || `Chapter ${i + 1}`;
      let text = await getCachedSectionText(bookId, filePath, href);
      if (!text) {
        text = await loadSpineItemText(book, item);
        const clean = text.replace(/\s+/g, ' ').trim();
        if (clean) {
          await putCachedSectionText(bookId, filePath, href, clean);
          text = clean;
        }
      }

      if (!text) continue;
      w.postMessage({ type: 'section', token, cfiBase: href, section, text } satisfies WorkerSectionMessage);
    }

    w.postMessage({ type: 'finish', token } satisfies WorkerFinishMessage);
    await donePromise;
  } finally {
    workerHandlers.delete(token);
  }

  if (!isCancelled()) {
    await idbPut(STORES.searchResults, searchResultsKey(bookId, filePath, query), {
      filePath,
      results,
      createdAt: Date.now(),
    } satisfies CachedResults);
  }

  return results;
}
