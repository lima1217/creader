import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { getSelectionPosition } from './epubSelectionListeners';
import { createLogger } from '../../utils/logger';

const logger = createLogger('useEpubSelectionTracking');

export function useEpubSelectionTracking(params: {
  renditionRef: RefObject<ReaderRendition | null>;
  renditionKey: number;
  setSelectedText: (text: string) => void;
  setSelectedCfiRange: (cfiRange: string) => void;
  setSelectionToolbarPos: (pos: { x: number; y: number } | null) => void;
  setShowSelectionToolbar: (show: boolean) => void;
  setShowSelectionHint: (show: boolean) => void;
}) {
  const {
    renditionRef,
    renditionKey,
    setSelectedText,
    setSelectedCfiRange,
    setSelectionToolbarPos,
    setShowSelectionToolbar,
    setShowSelectionHint,
  } = params;

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    let lastSelectedText = '';

    const maybeShowHintOnce = () => {
      const hasSeenHint = localStorage.getItem('creader_selection_hint_seen');
      if (hasSeenHint) return;
      setShowSelectionHint(true);
      setTimeout(() => setShowSelectionHint(false), 5000);
      localStorage.setItem('creader_selection_hint_seen', 'true');
    };

    const onSelected = (cfiRange: unknown, contents: unknown) => {
      try {
        const win = (contents as { window?: Window } | null)?.window;
        if (!win) return;

        const position = getSelectionPosition(win);
        if (!position) return;

        const text = win.getSelection()?.toString().trim() ?? '';
        if (text && text !== lastSelectedText) {
          lastSelectedText = text;
          setSelectedText(text);
          setSelectedCfiRange(typeof cfiRange === 'string' ? cfiRange : '');
        }

        setSelectionToolbarPos(position);
        setShowSelectionToolbar(true);
        maybeShowHintOnce();
      } catch (e) {
        logger.warn('Failed to resolve selection position:', e);
      }
    };

    const onSelectionCleared = () => {
      lastSelectedText = '';
      setShowSelectionToolbar(false);
      setSelectionToolbarPos(null);
      setSelectedText('');
    };

    rendition.on('selected', onSelected);
    rendition.on('selectionCleared', onSelectionCleared);

    return () => {
      rendition.off('selected', onSelected);
      rendition.off('selectionCleared', onSelectionCleared);
    };
  }, [renditionKey, setSelectedText, setSelectedCfiRange, setSelectionToolbarPos, setShowSelectionHint, setShowSelectionToolbar]);
}
