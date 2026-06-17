import type { ReaderSearchResult } from './types';
import type { EpubBookLike, EpubSpineItem } from './epubAdapter';
import { STORES } from '../Db';
import { idbGet, idbPut } from '../idb';

const MAX_RESULTS = 50;
const MAX_PER_SECTION = 3;
const EXCERPT_RADIUS = 50;

type CachedResults = {
  filePath: string;
  results: ReaderSearchResult[];
  createdAt: number;
};

function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, ' ');
}

function searchResultsKey(bookId: string, filePath: string, query: string): string {
  return `results:${bookId}:${filePath}:${query.toLowerCase()}`;
}

function extractTextFromDocLike(doc: unknown): string {
  if (!doc) return '';
  if (typeof doc === 'string') {
    const parsedDoc = new DOMParser().parseFromString(doc, 'text/html');
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
      const text = extractTextFromDocLike(await item.load(book.load?.bind(book)));
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
      const text = extractTextFromDocLike(await book.archive.getText(href));
      if (text) return text;
    } catch {
    }
  }

  if (href && book.archive?.request) {
    try {
      const text = extractTextFromDocLike(await book.archive.request(href, 'text'));
      if (text) return text;
    } catch {
    }
  }

  if (href && book.load) {
    try {
      const text = extractTextFromDocLike(await book.load(href));
      if (text) return text;
    } catch {
    }
  }

  return '';
}

function pushUnique(results: ReaderSearchResult[], seen: Set<string>, result: ReaderSearchResult): void {
  const key = `${result.cfi}::${result.excerpt}`;
  if (seen.has(key)) return;
  seen.add(key);
  results.push(result);
}

function searchText(text: string, query: string, cfiBase: string, section: string): ReaderSearchResult[] {
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const results: ReaderSearchResult[] = [];
  let found = lower.indexOf(needle);

  while (found !== -1 && results.length < MAX_PER_SECTION) {
    const start = Math.max(0, found - EXCERPT_RADIUS);
    const end = Math.min(text.length, found + query.length + EXCERPT_RADIUS);
    let excerpt = text.slice(start, end).replace(/\s+/g, ' ').trim();
    if (start > 0) excerpt = `...${excerpt}`;
    if (end < text.length) excerpt = `${excerpt}...`;
    results.push({ cfi: cfiBase, excerpt, section });
    found = lower.indexOf(needle, found + needle.length);
  }

  return results;
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

  const cacheKey = searchResultsKey(bookId, filePath, query);
  const cached = await idbGet<CachedResults>(STORES.searchResults, cacheKey);
  if (cached && cached.filePath === filePath && cached.results.length > 0) return cached.results;

  const spineItems = book.spine?.spineItems || book.spine?.items || [];
  const seen = new Set<string>();
  const results: ReaderSearchResult[] = [];

  for (let i = 0; i < spineItems.length && results.length < MAX_RESULTS; i++) {
    if (isCancelled()) break;
    const item = spineItems[i];
    const section = item.idref || item.label || `Chapter ${i + 1}`;
    const cfiBase = item.href || item.url || `section_${i}`;

    if (item.find) {
      try {
        const findResults = await item.find(query);
        if (findResults.length > 0) {
          for (const fr of findResults.slice(0, MAX_PER_SECTION)) {
            pushUnique(results, seen, { cfi: fr.cfi ?? cfiBase, excerpt: fr.excerpt || query, section });
            if (results.length >= MAX_RESULTS) break;
          }
          if (results.length >= MAX_RESULTS) break;
          continue;
        }
      } catch {
      }
    }

    const text = (await loadSpineItemText(book, item)).replace(/\s+/g, ' ').trim();
    for (const result of searchText(text, query, cfiBase, section)) {
      pushUnique(results, seen, result);
      if (results.length >= MAX_RESULTS) break;
    }
  }

  if (!isCancelled()) {
    await idbPut(STORES.searchResults, cacheKey, {
      filePath,
      results,
      createdAt: Date.now(),
    } satisfies CachedResults);
  }

  return results;
}
