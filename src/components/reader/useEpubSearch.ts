import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Book as EpubBook, Rendition } from 'epubjs';
import type { Book } from '../../types';
import type { EpubBookLike } from '../../services/reader/epubAdapter';
import type { ReaderSearchResult } from '../../services/reader/types';
import { searchBookCached } from '../../services/reader/searchCached';
import { createLogger } from '../../utils/logger';

const logger = createLogger('useEpubSearch');

export function useEpubSearch(params: {
  bookRef: RefObject<EpubBook | null>;
  renditionRef: RefObject<Rendition | null>;
  currentBook: Book | null;
  onCloseSearch: () => void;
}) {
  const { bookRef, renditionRef, currentBook, onCloseSearch } = params;
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ReaderSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTokenRef = useRef(0);

  const cancelSearch = useCallback(() => {
    searchTokenRef.current += 1;
    setIsSearching(false);
  }, []);

  const handleSearch = useCallback(async () => {
    if (!bookRef.current || !currentBook || !searchQuery.trim()) return;

    const token = ++searchTokenRef.current;
    setIsSearching(true);
    setSearchResults([]);

    try {
      const book = bookRef.current as unknown as EpubBookLike;
      const results = await searchBookCached(
        book,
        currentBook.id,
        currentBook.filePath,
        searchQuery,
        () => token !== searchTokenRef.current
      );

      if (token === searchTokenRef.current) {
        setSearchResults(results);
      }
    } catch (err) {
      logger.error('Search failed:', err);
    } finally {
      if (token === searchTokenRef.current) {
        setIsSearching(false);
      }
    }
  }, [bookRef, currentBook, searchQuery]);

  const handleSearchResultClick = useCallback((cfi: string) => {
    renditionRef.current?.display(cfi);
    cancelSearch();
    onCloseSearch();
  }, [cancelSearch, onCloseSearch, renditionRef]);

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    isSearching,
    handleSearch,
    cancelSearch,
    handleSearchResultClick,
    setSearchResults,
  };
}
