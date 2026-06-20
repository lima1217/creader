import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { Rendition } from 'epubjs';
import type { EpubBookLike } from '../../services/reader/epubAdapter';
import { getRenditionContents } from '../../services/reader/epubAdapter';
import { computeEpubPercentage } from './epubProgress';
import { CHAPTER_EXTRACT_INTERVAL_MS, MAX_CHAPTER_CONTENT_LENGTH, PROGRESS_UPDATE_INTERVAL_MS, PROGRESS_UPDATE_THRESHOLD_PERCENT } from '../../constants';
import { createLogger } from '../../utils/logger';

const logger = createLogger('useEpubProgressTracking');

export function useEpubProgressTracking(params: {
  renditionRef: RefObject<Rendition | null>;
  bookLikeRef: RefObject<EpubBookLike | null>;
  renditionKey: number;
  bookId: string | null;
  locationsStatus: 'pending' | 'ready' | 'unavailable';
  updateBookProgress: (bookId: string, update: { kind: 'epub'; currentCfi: string; percentage: number }) => void;
  setCurrentChapterContent: (content: string) => void;
}) {
  const { renditionRef, bookLikeRef, renditionKey, bookId, locationsStatus, updateBookProgress, setCurrentChapterContent } = params;
  const progressStateRef = useRef({ lastTs: 0, lastCfi: '', lastPercentage: 0 });
  const chapterStateRef = useRef({ lastTs: 0, lastCfi: '' });

  useEffect(() => {
    progressStateRef.current = { lastTs: 0, lastCfi: '', lastPercentage: 0 };
    chapterStateRef.current = { lastTs: 0, lastCfi: '' };
  }, [bookId]);

  useEffect(() => {
    const rendition = renditionRef.current;
    const bookAny = bookLikeRef.current;
    if (!rendition || !bookAny || !bookId) return;

    const handleLocationChange = (location: any) => {
      if (!location) return;

      let cfi = '';
      let percentage = 0;

      if (location.start?.cfi) {
        cfi = location.start.cfi;
      } else if (typeof location === 'string') {
        cfi = location;
      }

      percentage = computeEpubPercentage({ location, cfi, bookAny });

      // The first relocation happens before cached locations are restored. Do
      // not replace a saved exact percentage with the coarse spine fallback.
      if (cfi && locationsStatus !== 'pending') {
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
          updateBookProgress(bookId, { kind: 'epub', currentCfi: cfi, percentage });
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

    // Restoring locations does not emit another relocation. Re-evaluate the
    // visible page once exact percentages become available (or fallback is final).
    if (locationsStatus !== 'pending') {
      try {
        const current = (rendition as any).currentLocation?.();
        if (current?.then) {
          void current.then(handleLocationChange);
        } else if (current) {
          handleLocationChange(current);
        }
      } catch {
      }
    }

    return () => {
      rendition.off('locationChanged', handleLocationChange);
      rendition.off('relocated', handleLocationChange);
    };
  }, [renditionKey, bookId, locationsStatus, updateBookProgress, setCurrentChapterContent]);
}
