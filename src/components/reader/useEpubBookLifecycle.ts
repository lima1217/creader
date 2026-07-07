import { useEffect } from 'react';
import type { RefObject } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import type { Settings, Book, NavItem } from '../../types';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { resolveFontStack, FIXED_FONT_FAMILY_KEY } from './fontCatalog';
import { applyEpubTheme } from './epubTheme';
import { resolveFontFaceCss } from '../../services/reader/fontLoader';
import { foliateEngineAdapter } from '../../services/reader/foliateEngine';
import { DEFAULT_READING_LAYOUT } from '../../services/reader/readingEngine';
import type { ReadingEngineInstance } from '../../services/reader/readingEngine';
import { createLogger } from '../../utils/logger';
import { classifyBookOpenError, toBookOpenUserMessage } from '../../utils/errors';
import { perfSpan } from '../../utils/perf';
import { uint8ArrayToArrayBuffer } from '../../utils/arrayBuffer';

const logger = createLogger('useEpubBookLifecycle');

export function useEpubBookLifecycle(params: {
  currentBook: Book | null;
  containerRef: RefObject<HTMLDivElement | null>;
  settings: Settings;
  renditionRef: RefObject<ReaderRendition | null>;
  setToc: (toc: NavItem[]) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setIsFileNotFound: (isNotFound: boolean) => void;
  setIsEngineLoadError: (isEngineLoadError: boolean) => void;
  onRenditionCreated?: (rendition: ReaderRendition | null) => void;
}) {
  const {
    currentBook,
    containerRef,
    settings,
    renditionRef,
    setToc,
    setIsLoading,
    setError,
    setIsFileNotFound,
    setIsEngineLoadError,
    onRenditionCreated,
  } = params;

  useEffect(() => {
    if (!currentBook || !containerRef.current) return;

    let cancelled = false;
    let engineInstance: ReadingEngineInstance | null = null;

    const loadBook = async () => {
      setIsLoading(true);
      setError(null);
      setIsFileNotFound(false);
      setIsEngineLoadError(false);
      setToc([]);

      // Yield to allow the loading UI to paint before heavy work.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (cancelled) return;

      if (engineInstance) {
        engineInstance.destroy();
        engineInstance = null;
      }
      renditionRef.current = null;
      onRenditionCreated?.(null);

      try {
        const fileData = await perfSpan('epub:readFile', async () => readFile(currentBook.filePath));
        if (cancelled) return;

        const arrayBuffer = uint8ArrayToArrayBuffer(fileData);

        const container = containerRef.current;
        if (!container || cancelled) return;

        engineInstance = await perfSpan('epub:open', async () =>
          foliateEngineAdapter.open({ appBook: currentBook, arrayBuffer, container }),
        );
        if (cancelled) {
          engineInstance.destroy();
          engineInstance = null;
          return;
        }

        const { rendition, toc } = engineInstance;
        renditionRef.current = rendition;

        setToc(toc);
        if (onRenditionCreated) onRenditionCreated(rendition);

        const fontStack = resolveFontStack();
        let fontFaceCss = '';
        try {
          fontFaceCss = await resolveFontFaceCss(FIXED_FONT_FAMILY_KEY);
        } catch (error) {
          logger.warn('Failed to inject reading font faces:', error);
        }
        if (cancelled) return;

        applyEpubTheme(rendition, {
          theme: settings.theme,
          fontStack,
          fontSize: settings.fontSize,
          fontFaceCss,
        });

        // Pin the engine to the fixed scrolled layout before the first display
        // so the very first paint is already flow=scrolled (#88). Position is
        // preserved across later setLayout calls by foliate's `#anchor`.
        rendition.setLayout?.(DEFAULT_READING_LAYOUT);

        const startTarget = currentBook.progress.currentCfi || undefined;
        await perfSpan('epub:firstDisplay', async () => rendition.display(startTarget));

        setIsLoading(false);
      } catch (err) {
        logger.error('Failed to load book:', err);
        if (!cancelled) {
          const kind = classifyBookOpenError(err);
          setIsFileNotFound(kind === 'not-found');
          setIsEngineLoadError(kind === 'engine-load');
          setError(toBookOpenUserMessage(err));
          setIsLoading(false);
        }
      }
    };

    void loadBook();

    return () => {
      cancelled = true;
      if (engineInstance) {
        engineInstance.destroy();
        engineInstance = null;
      }
      renditionRef.current = null;
      onRenditionCreated?.(null);
    };
  }, [currentBook?.id, currentBook?.filePath]);
}
