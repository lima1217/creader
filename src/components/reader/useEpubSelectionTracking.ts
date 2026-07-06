import { useEffect } from 'react';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { getSelectionPosition } from './epubSelectionListeners';
import { createLogger } from '../../utils/logger';

const logger = createLogger('useEpubSelectionTracking');

export function useEpubSelectionTracking(params: {
  rendition: ReaderRendition | null;
  setSelectedText: (text: string) => void;
  setSelectedCfiRange: (cfiRange: string) => void;
  setSelectionToolbarPos: (pos: { x: number; y: number } | null) => void;
  setShowSelectionToolbar: (show: boolean) => void;
  setShowSelectionHint: (show: boolean) => void;
}) {
  const {
    rendition,
    setSelectedText,
    setSelectedCfiRange,
    setSelectionToolbarPos,
    setShowSelectionToolbar,
    setShowSelectionHint,
  } = params;

  useEffect(() => {
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
        }
        if (typeof cfiRange === 'string' && cfiRange) {
          setSelectedCfiRange(cfiRange);
        } else if (text) {
          setSelectedCfiRange('');
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
      setSelectedCfiRange('');
    };

    rendition.on('selected', onSelected);
    rendition.on('selectionCleared', onSelectionCleared);

    return () => {
      rendition.off('selected', onSelected);
      rendition.off('selectionCleared', onSelectionCleared);
    };
  }, [rendition, setSelectedText, setSelectedCfiRange, setSelectionToolbarPos, setShowSelectionHint, setShowSelectionToolbar]);
}
