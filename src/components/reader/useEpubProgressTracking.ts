import { useEffect, useRef } from 'react';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { getRenditionContents } from '../../services/reader/epubAdapter';
import { sliceChapterContent } from '../../domain/contextWindow';
import { useSelectionStore } from '../../stores/selectionStore';
import { computeChapterRemainingPercent, computeEpubPercentage } from './epubProgress';
import { CHAPTER_EXTRACT_INTERVAL_MS, MAX_CHAPTER_CONTENT_LENGTH, PROGRESS_UPDATE_INTERVAL_MS, PROGRESS_UPDATE_THRESHOLD_PERCENT } from '../../constants';
import { createLogger } from '../../utils/logger';

const logger = createLogger('useEpubProgressTracking');

function readLocationStart(location: unknown): {
  cfi: string;
  index: number | null;
  title: string | null;
  sectionFraction: number | null;
} {
  if (!location || typeof location !== 'object') {
    return { cfi: '', index: null, title: null, sectionFraction: null };
  }

  const start = (location as { start?: Record<string, unknown> }).start;
  if (!start) {
    if (typeof location === 'string') {
      return { cfi: location, index: null, title: null, sectionFraction: null };
    }
    return { cfi: '', index: null, title: null, sectionFraction: null };
  }

  const cfi = typeof start.cfi === 'string' ? start.cfi : '';
  const index = typeof start.index === 'number' && Number.isFinite(start.index)
    ? start.index
    : null;
  const label = typeof start.label === 'string' ? start.label.trim() : '';
  const title = label || (index !== null ? `Chapter ${index + 1}` : null);
  const sectionFraction = typeof start.sectionFraction === 'number' && Number.isFinite(start.sectionFraction)
    ? start.sectionFraction
    : null;

  return { cfi, index, title, sectionFraction };
}

export function useEpubProgressTracking(params: {
  rendition: ReaderRendition | null;
  bookId: string | null;
  updateBookProgress: (bookId: string, update: { currentCfi: string; percentage: number }) => void;
  setCurrentChapterSlice: (slice: { content: string; offset: number; truncatedEnd: boolean }) => void;
  setCurrentChapterLocation: (location: {
    index: number | null;
    title: string | null;
    remainingPercent: number | null;
  }) => void;
}) {
  const { rendition, bookId, updateBookProgress, setCurrentChapterSlice, setCurrentChapterLocation } = params;
  const progressStateRef = useRef({ lastTs: 0, lastCfi: '', lastPercentage: 0 });
  const chapterStateRef = useRef({ lastTs: 0, lastCfi: '' });

  useEffect(() => {
    progressStateRef.current = { lastTs: 0, lastCfi: '', lastPercentage: 0 };
    chapterStateRef.current = { lastTs: 0, lastCfi: '' };
    setCurrentChapterLocation({ index: null, title: null, remainingPercent: null });
    setCurrentChapterSlice({ content: '', offset: 0, truncatedEnd: false });
  }, [bookId, setCurrentChapterLocation, setCurrentChapterSlice]);

  useEffect(() => {
    if (!rendition || !bookId) return;

    const handleLocationChange = (location: unknown) => {
      if (!location) return;

      const { cfi, index, title, sectionFraction } = readLocationStart(location);
      setCurrentChapterLocation({
        index,
        title,
        remainingPercent: computeChapterRemainingPercent(sectionFraction),
      });

      if (cfi) {
        const percentage = computeEpubPercentage({ location, cfi });
        const now = Date.now();
        const last = progressStateRef.current;
        const percentageDelta = Math.abs(percentage - last.lastPercentage);
        const shouldUpdate =
          cfi !== last.lastCfi &&
          (now - last.lastTs >= PROGRESS_UPDATE_INTERVAL_MS || percentageDelta >= PROGRESS_UPDATE_THRESHOLD_PERCENT);

        if (shouldUpdate) {
          progressStateRef.current = {
            lastTs: now,
            lastCfi: cfi,
            lastPercentage: percentage,
          };
          updateBookProgress(bookId, { currentCfi: cfi, percentage });
        }
      }

      try {
        const now = Date.now();
        const last = chapterStateRef.current;
        if (now - last.lastTs >= CHAPTER_EXTRACT_INTERVAL_MS && cfi && cfi !== last.lastCfi) {
          chapterStateRef.current = { lastTs: now, lastCfi: cfi };
          const contents = getRenditionContents(rendition);
          const content = contents[0];
          const body = content?.document?.body;
          const rawText = body?.innerText || body?.textContent || '';
          const normalized = rawText
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
            if (normalized) {
            const selectedText = useSelectionStore.getState().selectedText.trim();
            const slice = sliceChapterContent(
              normalized,
              MAX_CHAPTER_CONTENT_LENGTH,
              selectedText || undefined,
            );
            setCurrentChapterSlice({
              content: slice.text,
              offset: slice.offset,
              truncatedEnd: slice.truncatedEnd,
            });
          }
        }
      } catch (e) {
        logger.warn('Failed to extract chapter content:', e);
      }
    };

    rendition.on('locationChanged', handleLocationChange);
    rendition.on('relocated', handleLocationChange);

    try {
      const current = rendition.currentLocation?.();
      if (current && typeof (current as Promise<unknown>).then === 'function') {
        void (current as Promise<unknown>).then(handleLocationChange);
      } else if (current) {
        handleLocationChange(current);
      }
    } catch {
    }

    return () => {
      rendition.off('locationChanged', handleLocationChange);
      rendition.off('relocated', handleLocationChange);
    };
  }, [rendition, bookId, updateBookProgress, setCurrentChapterSlice, setCurrentChapterLocation]);
}
