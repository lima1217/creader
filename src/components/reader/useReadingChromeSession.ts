import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { useAIStore } from '../../stores/aiStore';
import { useProgressStore } from '../../stores/progressStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUIStore } from '../../stores/uiStore';
import type { Book, NavItem } from '../../types';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { createLogger } from '../../utils/logger';
import { isTocItemActive } from './readerNavigation';
import { useEpubProgressTracking } from './useEpubProgressTracking';
import { useEpubSelectionTracking } from './useEpubSelectionTracking';
import { useReaderKeyboardShortcuts } from './useReaderKeyboardShortcuts';

const logger = createLogger('useReadingChromeSession');

export function useReadingChromeSession(params: {
  currentBook: Book | null;
  renditionRef: RefObject<ReaderRendition | null>;
  renditionKey: number;
}) {
  const { currentBook, renditionRef, renditionKey } = params;
  const updateBookProgress = useProgressStore((s) => s.updateBookProgress);
  const showToc = useUIStore((s) => s.isTocOpen);
  const setShowToc = useUIStore((s) => s.setTocOpen);
  const setAIPanelOpen = useUIStore((s) => s.setAIPanelOpen);
  const setCurrentChapterContent = useAIStore((s) => s.setCurrentChapterContent);
  const selectedText = useSelectionStore((s) => s.selectedText);
  const setSelectedText = useSelectionStore((s) => s.setSelectedText);
  const setSelectedCfiRange = useSelectionStore((s) => s.setSelectedCfiRange);
  const addToAccumulatedTexts = useSelectionStore((s) => s.addToAccumulatedTexts);
  const accumulatedTexts = useSelectionStore((s) => s.accumulatedTexts);

  const [toc, setToc] = useState<NavItem[]>([]);
  const [currentTocHref, setCurrentTocHref] = useState('');
  const [selectionToolbarPos, setSelectionToolbarPos] = useState<{ x: number; y: number } | null>(null);
  const [showSelectionToolbar, setShowSelectionToolbar] = useState(false);
  const [showSelectionHint, setShowSelectionHint] = useState(false);
  const [accumulatedPreviewOpen, setAccumulatedPreviewOpen] = useState(false);

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
  }, [closeSelectionToolbar, renditionRef, setShowToc]);

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

  const isTocItemCurrent = useCallback((href: string) => (
    isTocItemActive(href, currentTocHref)
  ), [currentTocHref]);

  useEpubProgressTracking({
    renditionRef,
    renditionKey,
    bookId: currentBook?.id ?? null,
    updateBookProgress,
    setCurrentChapterContent,
  });

  useEpubSelectionTracking({
    renditionRef,
    renditionKey,
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
      return !!target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
    },
    onPrev: handlePrev,
    onNext: handleNext,
    onEscape: () => {
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

  return {
    toc,
    setToc,
    showToc,
    setShowToc,
    toggleToc: () => setShowToc(!showToc),
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
  };
}
