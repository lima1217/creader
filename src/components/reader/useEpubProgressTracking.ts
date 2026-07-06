import { useEffect, useRef } from 'react';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { getRenditionContents } from '../../services/reader/epubAdapter';
import { computeEpubPercentage } from './epubProgress';
import { CHAPTER_EXTRACT_INTERVAL_MS, MAX_CHAPTER_CONTENT_LENGTH, PROGRESS_UPDATE_INTERVAL_MS, PROGRESS_UPDATE_THRESHOLD_PERCENT } from '../../constants';
import { createLogger } from '../../utils/logger';

const logger = createLogger('useEpubProgressTracking');

export function useEpubProgressTracking(params: {
  rendition: ReaderRendition | null;
  bookId: string | null;
  updateBookProgress: (bookId: string, update: { currentCfi: string; percentage: number }) => void;
  setCurrentChapterContent: (content: string) => void;
}) {
  const { rendition, bookId, updateBookProgress, setCurrentChapterContent } = params;
  const progressStateRef = useRef({ lastTs: 0, lastCfi: '', lastPercentage: 0 });
  const chapterStateRef = useRef({ lastTs: 0, lastCfi: '' });

  useEffect(() => {
    progressStateRef.current = { lastTs: 0, lastCfi: '', lastPercentage: 0 };
    chapterStateRef.current = { lastTs: 0, lastCfi: '' };
  }, [bookId]);

  useEffect(() => {
    if (!rendition || !bookId) return;

    const handleLocationChange = (location: any) => {
      if (!location) return;

      let cfi = '';
      let percentage = 0;

      if (location.start?.cfi) {
        cfi = location.start.cfi;
      } else if (typeof location === 'string') {
        cfi = location;
      }

      percentage = computeEpubPercentage({ location, cfi });

      if (cfi) {
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
          if (normalized) setCurrentChapterContent(normalized.slice(0, MAX_CHAPTER_CONTENT_LENGTH));
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
  }, [rendition, bookId, updateBookProgress, setCurrentChapterContent]);
}
