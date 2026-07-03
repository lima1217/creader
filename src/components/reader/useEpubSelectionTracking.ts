import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { getRenditionContents, setSelectionPollingInterval } from '../../services/reader/epubAdapter';
import { getSelectionFromEpubContent, setupEpubSelectionListeners } from './epubSelectionListeners';
import { createLogger } from '../../utils/logger';

const logger = createLogger('useEpubSelectionTracking');

export function useEpubSelectionTracking(params: {
  renditionRef: RefObject<ReaderRendition | null>;
  renditionKey: number;
  containerRef: RefObject<HTMLDivElement | null>;
  lastMousePosRef: RefObject<{ x: number; y: number }>;
  setSelectedText: (text: string) => void;
  setSelectedCfiRange: (cfiRange: string) => void;
  setSelectionToolbarPos: (pos: { x: number; y: number } | null) => void;
  setShowSelectionToolbar: (show: boolean) => void;
  setShowSelectionHint: (show: boolean) => void;
}) {
  const {
    renditionRef,
    renditionKey,
    containerRef,
    lastMousePosRef,
    setSelectedText,
    setSelectedCfiRange,
    setSelectionToolbarPos,
    setShowSelectionToolbar,
    setShowSelectionHint,
  } = params;

  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    let lastSelectedText = '';
    let selectionPollingStopAt = 0;
    let selectionPollingInterval: number | null = null;

    const maybeShowHintOnce = () => {
      const hasSeenHint = localStorage.getItem('creader_selection_hint_seen');
      if (hasSeenHint) return;
      setShowSelectionHint(true);
      setTimeout(() => setShowSelectionHint(false), 5000);
      localStorage.setItem('creader_selection_hint_seen', 'true');
    };

    const stopSelectionPolling = () => {
      if (selectionPollingInterval !== null) {
        clearInterval(selectionPollingInterval);
        selectionPollingInterval = null;
        setSelectionPollingInterval(rendition, null);
      }
    };

    const updateSelectionFromWindow = (win: Window, cfiRange = '') => {
      const iframe = containerRef.current?.querySelector('iframe') ?? null;
      const selection = getSelectionFromEpubContent({
        win,
        iframe,
        lastMousePos: lastMousePosRef.current,
      });
      if (!selection) return;

      if (selection.text !== lastSelectedText) {
        lastSelectedText = selection.text;
        setSelectedText(selection.text);
        setSelectedCfiRange(cfiRange);
      }

      if (selection.position) {
        setSelectionToolbarPos(selection.position);
        setShowSelectionToolbar(true);
        maybeShowHintOnce();
      }
    };

    const startSelectionPolling = (durationMs: number) => {
      const now = Date.now();
      selectionPollingStopAt = Math.max(selectionPollingStopAt, now + durationMs);
      if (selectionPollingInterval !== null) return;

      selectionPollingInterval = window.setInterval(() => {
        const pollNow = Date.now();
        if (pollNow >= selectionPollingStopAt) {
          stopSelectionPolling();
          return;
        }
        try {
          const contents = getRenditionContents(rendition);
          if (contents.length > 0) {
            const before = lastSelectedText;
            for (const content of contents) {
              if (content && content.window) {
                updateSelectionFromWindow(content.window);
                if (lastSelectedText !== before) break;
              }
            }
          }
        } catch {
        }
      }, 1100);

      setSelectionPollingInterval(rendition, selectionPollingInterval);
    };

    const onSelected = (cfiRange: any, contents: any) => {
      try {
        if (contents?.window) {
          updateSelectionFromWindow(contents.window, typeof cfiRange === 'string' ? cfiRange : '');
        }
      } catch (e) {
        logger.warn('Failed to get selection from epub event:', e);
      }
    };

    rendition.on('selected', onSelected);

    const selectionListenersCleanup = setupEpubSelectionListeners({
      rendition,
      containerRef,
      lastMousePosRef,
      startSelectionPolling,
      updateSelectionFromWindow,
      setShowSelectionToolbar,
    });

    cleanupRef.current = () => {
      rendition.off('selected', onSelected);
      selectionListenersCleanup();
      stopSelectionPolling();
    };

    return () => {
      if (cleanupRef.current) cleanupRef.current();
      cleanupRef.current = null;
    };
  }, [renditionKey, setSelectedText, setSelectedCfiRange, setSelectionToolbarPos, setShowSelectionHint, setShowSelectionToolbar]);
}
