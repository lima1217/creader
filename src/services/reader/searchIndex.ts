import { invoke } from '@tauri-apps/api/core';
import type { SearchIndexState, SearchIndexSummary } from '../../types';
import type { ReaderSearchResult } from './types';

export type SearchIndexStatus = {
  state: SearchIndexState;
  error?: string | null;
  indexedAtMs?: number | null;
};

type RustSearchResult = {
  locator: {
    kind: string;
    href: string;
    spineIndex: number;
    cfi?: string | null;
  };
  sectionTitle: string;
  excerpt: string;
  score: number;
};

export function toSearchIndexSummary(status: SearchIndexStatus): SearchIndexSummary {
  return {
    state: status.state,
    error: status.error || undefined,
    indexedAtMs: typeof status.indexedAtMs === 'number' ? status.indexedAtMs : undefined,
  };
}

export async function getSearchIndexStatus(params: {
  bookId: string;
  filePath: string;
}): Promise<SearchIndexStatus> {
  return invoke<SearchIndexStatus>('get_search_index_status', {
    bookId: params.bookId,
    filePath: params.filePath,
  });
}

export async function rebuildSearchIndex(params: {
  bookId: string;
  filePath: string;
}): Promise<SearchIndexStatus> {
  return invoke<SearchIndexStatus>('rebuild_search_index', {
    bookId: params.bookId,
    filePath: params.filePath,
  });
}

export async function searchBookIndex(params: {
  bookId: string;
  filePath: string;
  query: string;
}): Promise<ReaderSearchResult[]> {
  const results = await invoke<RustSearchResult[]>('search_book', {
    bookId: params.bookId,
    filePath: params.filePath,
    query: params.query,
  });
  return results.map(result => ({
    cfi: result.locator.cfi || result.locator.href,
    locator: result.locator,
    excerpt: result.excerpt,
    section: result.sectionTitle,
    score: result.score,
  }));
}

export async function rebuildSearchIndexQuietly(params: {
  bookId: string;
  filePath: string;
  onStatus?: (status: SearchIndexStatus) => void;
}): Promise<void> {
  try {
    params.onStatus?.({ state: 'pending' });
    const status = await rebuildSearchIndex(params);
    params.onStatus?.(status);
  } catch (error) {
    params.onStatus?.({
      state: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
