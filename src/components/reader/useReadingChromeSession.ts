import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useAIStore } from '../../stores/aiStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { useProgressStore } from '../../stores/progressStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUIStore } from '../../stores/uiStore';
import type { Book, NavItem } from '../../types';
import type { EpubBookLike, ReaderRendition } from '../../services/reader/epubAdapter';
import { createLogger } from '../../utils/logger';
import { findChapterLabelByHref, isTocItemActive } from './readerNavigation';
import { useEpubProgressTracking } from './useEpubProgressTracking';
import { useEpubSearch } from './useEpubSearch';
import { useEpubSelectionTracking } from './useEpubSelectionTracking';
import { useReaderKeyboardShortcuts } from './useReaderKeyboardShortcuts';

const logger = createLogger('useReadingChromeSession');

function searchIndexMessage(state: string, error?: string): string {
  switch (state) {
    case 'pending':
      return '搜索索引正在构建，稍后即可搜索。';
    case 'failed':
      return error || '搜索索引构建失败，可以重试。';
    case 'stale':
      return '书籍文件已变化，需要重建搜索索引。';
    case 'missing':
      return '这本书还没有搜索索引。';
    default:
      return '';
  }
}

export function useReadingChromeSession(params: {
  currentBook: Book | null;
  containerRef: RefObject<HTMLDivElement | null>;
  renditionRef: RefObject<ReaderRendition | null>;
  bookLikeRef: RefObject<EpubBookLike | null>;
  renditionKey: number;
  lastMousePosRef: RefObject<{ x: number; y: number }>;
}) {
  const { currentBook, containerRef, renditionRef, bookLikeRef, renditionKey, lastMousePosRef } = params;
  const updateBookSearchIndex = useLibraryStore((s) => s.updateBookSearchIndex);
  const updateBookProgress = useProgressStore((s) => s.updateBookProgress);
  const isSearchOpen = useUIStore((s) => s.isSearchOpen);
  const setSearchOpen = useUIStore((s) => s.setSearchOpen);
  const setAIPanelOpen = useUIStore((s) => s.setAIPanelOpen);
  const currentChapterContent = useAIStore((s) => s.currentChapterContent);
  const setCurrentChapterContent = useAIStore((s) => s.setCurrentChapterContent);
  const selectedText = useSelectionStore((s) => s.selectedText);
  const setSelectedText = useSelectionStore((s) => s.setSelectedText);
  const setSelectedCfiRange = useSelectionStore((s) => s.setSelectedCfiRange);
  const addToAccumulatedTexts = useSelectionStore((s) => s.addToAccumulatedTexts);
  const accumulatedTexts = useSelectionStore((s) => s.accumulatedTexts);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [showToc, setShowToc] = useState(false);
  const [currentTocHref, setCurrentTocHref] = useState('');
  const [selectionToolbarPos, setSelectionToolbarPos] = useState<{ x: number; y: number } | null>(null);
  const [showSelectionToolbar, setShowSelectionToolbar] = useState(false);
  const [showSelectionHint, setShowSelectionHint] = useState(false);
  const [chapterCopied, setChapterCopied] = useState(false);
  const [accumulatedPreviewOpen, setAccumulatedPreviewOpen] = useState(false);

  const handleSearchIndexStatus = useCallback((status: NonNullable<Book['searchIndex']>) => {
    if (currentBook) updateBookSearchIndex(currentBook.id, status);
  }, [currentBook, updateBookSearchIndex]);

  const search = useEpubSearch({
    renditionRef,
    currentBook,
    onSearchIndexStatus: handleSearchIndexStatus,
    onCloseSearch: () => setSearchOpen(false),
  });
  const { cancelSearch, refreshIndexStatus } = search;

  const closeSelectionToolbar = useCallback(() => {
    setShowSelectionToolbar(false);
  }, []);

  const handlePrev = useCallback(() => {
    renditionRef.current?.prev();
    closeSelectionToolbar();
  }, [closeSelectionToolbar, renditionRef]);

  const handleNext = useCallback(() => {
    renditionRef.current?.next();
    closeSelectionToolbar();
  }, [closeSelectionToolbar, renditionRef]);

  const handleTocClick = useCallback((href: string) => {
    if (!href) return;
    const displayResult = renditionRef.current?.display(href);
    void Promise.resolve(displayResult).catch((err: unknown) => logger.warn('TOC navigation failed:', err));
    setShowToc(false);
    closeSelectionToolbar();
  }, [closeSelectionToolbar, renditionRef]);

  const closeSearch = useCallback(() => {
    cancelSearch();
    setSearchOpen(false);
  }, [cancelSearch, setSearchOpen]);

  const handleAddSelection = useCallback(() => {
    addToAccumulatedTexts(selectedText);
  }, [addToAccumulatedTexts, selectedText]);

  const handleAskSelection = useCallback(() => {
    setAIPanelOpen(true);
    closeSelectionToolbar();
  }, [closeSelectionToolbar, setAIPanelOpen]);

  const handleCloseSelection = useCallback(() => {
    setShowSelectionToolbar(false);
    setSelectionToolbarPos(null);
    setSelectedText('');
  }, [setSelectedText]);

  const handleAccumulatedTextsClick = useCallback(() => {
    setAccumulatedPreviewOpen(open => !open);
    setAIPanelOpen(true);
  }, [setAIPanelOpen]);

  const handleUseChapter = useCallback(() => {
    addToAccumulatedTexts(currentChapterContent);
    setAIPanelOpen(true);
  }, [addToAccumulatedTexts, currentChapterContent, setAIPanelOpen]);

  const handleCopyChapter = useCallback(async () => {
    if (!currentChapterContent) return;

    try {
      await navigator.clipboard.writeText(currentChapterContent);
      setChapterCopied(true);
      setTimeout(() => setChapterCopied(false), 2000);
    } catch {
      logger.warn('Failed to copy chapter content');
    }
  }, [currentChapterContent]);

  const resolveChapterLabel = useCallback((result: { section?: string; cfi?: string }) => {
    const href = (result.cfi || '').split('#')[0].trim();
    const viaHref = href ? findChapterLabelByHref(toc, href) : undefined;
    if (viaHref) return viaHref;
    const section = result.section || '';
    if (section && !/^(id\d+|.*\.(x?html|htm|xhtml))$/i.test(section)) return section;
    return '';
  }, [toc]);

  const isTocItemCurrent = useCallback((href: string) => (
    isTocItemActive(href, currentTocHref)
  ), [currentTocHref]);

  useEpubProgressTracking({
    renditionRef,
    bookLikeRef,
    renditionKey,
    bookId: currentBook?.id ?? null,
    updateBookProgress,
    setCurrentChapterContent,
  });

  useEpubSelectionTracking({
    renditionRef,
    renditionKey,
    containerRef,
    lastMousePosRef,
    setSelectedText,
    setSelectedCfiRange,
    setSelectionToolbarPos,
    setShowSelectionToolbar,
    setShowSelectionHint,
  });

  useReaderKeyboardShortcuts({
    enabled: Boolean(currentBook),
    isEditableTarget: (target) => {
      if (!(target instanceof HTMLElement)) return false;
      // Cover native inputs plus contentEditable surfaces (e.g. Astryx ChatComposerInput),
      // including editable child nodes that report isContentEditable unreliably.
      return !!target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
    },
    onPrev: handlePrev,
    onNext: handleNext,
    onEscape: () => {
      closeSearch();
      setShowToc(false);
      closeSelectionToolbar();
    },
    onKey: (e) => {
      if ((e.key === 'a' || e.key === 'A') && selectedText) {
        setAIPanelOpen(true);
      }
    },
  });

  useEffect(() => {
    setChapterCopied(false);
  }, [currentChapterContent]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    const updateHref = () => {
      try {
        const loc = rendition.currentLocation?.() as { start?: { href?: unknown } } | undefined;
        const href = loc?.start?.href;
        if (typeof href === 'string') setCurrentTocHref(href);
      } catch {
        // currentLocation can throw before the book is fully laid out.
      }
    };

    updateHref();
    rendition.on('relocated', updateHref);
    rendition.on('locationChanged', updateHref);
    return () => {
      rendition.off('relocated', updateHref);
      rendition.off('locationChanged', updateHref);
    };
  }, [renditionKey, renditionRef]);

  useEffect(() => {
    if (isSearchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
      void refreshIndexStatus().catch(err => logger.warn('Failed to refresh search index status:', err));
    }
  }, [isSearchOpen, refreshIndexStatus]);

  const searchIndexState = currentBook?.searchIndex?.state || 'missing';
  const searchIndexNeedsRebuild = searchIndexState === 'missing' || searchIndexState === 'failed' || searchIndexState === 'stale';
  const searchStatusText = search.searchError || searchIndexMessage(searchIndexState, currentBook?.searchIndex?.error);

  return {
    toc,
    setToc,
    showToc,
    setShowToc,
    toggleToc: () => setShowToc(open => !open),
    handleTocClick,
    isTocItemCurrent,
    handlePrev,
    handleNext,
    selectionToolbar: {
      visible: showSelectionToolbar,
      position: selectionToolbarPos,
      selectedText,
      accumulatedCount: accumulatedTexts.length,
      showHint: showSelectionHint,
      onAdd: handleAddSelection,
      onAsk: handleAskSelection,
      onClose: handleCloseSelection,
    },
    accumulatedTexts,
    accumulatedPreviewOpen,
    onAccumulatedTextsClick: handleAccumulatedTextsClick,
    currentChapterContent,
    chapterCopied,
    onUseChapter: handleUseChapter,
    onCopyChapter: handleCopyChapter,
    search: {
      ...search,
      inputRef: searchInputRef,
      isOpen: isSearchOpen,
      close: closeSearch,
      indexState: searchIndexState,
      indexNeedsRebuild: searchIndexNeedsRebuild,
      statusText: searchStatusText,
      resolveChapterLabel,
    },
  };
}
