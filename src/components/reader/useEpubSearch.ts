import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Book, SearchIndexSummary } from '../../types';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import type { ReaderSearchResult } from '../../services/reader/types';
import { getSearchIndexStatus, rebuildSearchIndex, searchBookIndex, toSearchIndexSummary } from '../../services/reader/searchIndex';
import { createLogger } from '../../utils/logger';
import { resolveSearchResultTarget } from './readerNavigation';

const logger = createLogger('useEpubSearch');

export function useEpubSearch(params: {
  renditionRef: RefObject<ReaderRendition | null>;
  currentBook: Book | null;
  onSearchIndexStatus: (status: SearchIndexSummary) => void;
  onCloseSearch: () => void;
}) {
  const { renditionRef, currentBook, onSearchIndexStatus, onCloseSearch } = params;
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ReaderSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isRebuildingIndex, setIsRebuildingIndex] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchTokenRef = useRef(0);

  const refreshIndexStatus = useCallback(async () => {
    if (!currentBook) return null;
    const status = await getSearchIndexStatus({
      bookId: currentBook.id,
      filePath: currentBook.filePath,
    });
    const summary = toSearchIndexSummary(status);
    onSearchIndexStatus(summary);
    return summary;
  }, [currentBook, onSearchIndexStatus]);

  const cancelSearch = useCallback(() => {
    searchTokenRef.current += 1;
    setIsSearching(false);
  }, []);

  const handleSearch = useCallback(async () => {
    if (!currentBook || !searchQuery.trim()) return;

    const token = ++searchTokenRef.current;
    setIsSearching(true);
    setSearchResults([]);
    setSearchError(null);

    try {
      const status = await refreshIndexStatus();
      if (token !== searchTokenRef.current) return;
      if (status?.state !== 'ready') {
        setSearchError(status?.error || '搜索索引尚未就绪');
        return;
      }
      const results = await searchBookIndex({
        bookId: currentBook.id,
        filePath: currentBook.filePath,
        query: searchQuery,
      });

      if (token === searchTokenRef.current) {
        setSearchResults(results);
      }
    } catch (err) {
      logger.error('Search failed:', err);
      if (token === searchTokenRef.current) {
        setSearchError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (token === searchTokenRef.current) {
        setIsSearching(false);
      }
    }
  }, [currentBook, refreshIndexStatus, searchQuery]);

  const rebuildCurrentIndex = useCallback(async () => {
    if (!currentBook) return;
    setIsRebuildingIndex(true);
    setSearchError(null);
    onSearchIndexStatus({ state: 'pending' });
    try {
      const status = await rebuildSearchIndex({
        bookId: currentBook.id,
        filePath: currentBook.filePath,
      });
      onSearchIndexStatus(toSearchIndexSummary(status));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSearchError(message);
      onSearchIndexStatus({ state: 'failed', error: message });
    } finally {
      setIsRebuildingIndex(false);
    }
  }, [currentBook, onSearchIndexStatus]);

  const handleSearchResultClick = useCallback((result: ReaderSearchResult) => {
    const target = resolveSearchResultTarget(result);
    if (!target) {
      setSearchError('这个搜索结果缺少可跳转的位置。');
      return;
    }
    const displayResult = renditionRef.current?.display(target);
    void Promise.resolve(displayResult).catch((err: unknown) => {
      logger.warn('Search result navigation failed:', err);
      setSearchError('无法跳转到这个搜索结果。');
    });
    cancelSearch();
    onCloseSearch();
  }, [cancelSearch, onCloseSearch, renditionRef]);

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    isSearching,
    isRebuildingIndex,
    searchError,
    refreshIndexStatus,
    handleSearch,
    rebuildCurrentIndex,
    cancelSearch,
    handleSearchResultClick,
    setSearchResults,
  };
}
