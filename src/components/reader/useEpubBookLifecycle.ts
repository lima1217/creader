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
import { useSelectionStore } from '../../stores/selectionStore';
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

    // Generation token: every await after this must check `loadGeneration ===
    // activeGeneration` before writing UI state, so a slow open of book A
    // cannot clear book B's loading state or attach A's engine.
    const loadGeneration = Symbol(currentBook.id);
    let activeGeneration: symbol | null = loadGeneration;
    let engineInstance: ReadingEngineInstance | null = null;

    useSelectionStore.getState().clearSelection();

    const isCurrentGeneration = () => activeGeneration === loadGeneration;

    const discardEngine = () => {
      if (!engineInstance) return;
      engineInstance.destroy();
      engineInstance = null;
    };

    const loadBook = async () => {
      setIsLoading(true);
      setError(null);
      setIsFileNotFound(false);
      setIsEngineLoadError(false);
      setToc([]);

      // Yield to allow the loading UI to paint before heavy work.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!isCurrentGeneration()) return;

      discardEngine();
      renditionRef.current = null;
      onRenditionCreated?.(null);

      try {
        const fileData = await perfSpan('epub:readFile', async () => readFile(currentBook.filePath));
        if (!isCurrentGeneration()) return;

        const arrayBuffer = uint8ArrayToArrayBuffer(fileData);

        const container = containerRef.current;
        if (!container || !isCurrentGeneration()) return;

        engineInstance = await perfSpan('epub:open', async () =>
          foliateEngineAdapter.open({ appBook: currentBook, arrayBuffer, container }),
        );
        if (!isCurrentGeneration()) {
          discardEngine();
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
        if (!isCurrentGeneration()) {
          discardEngine();
          return;
        }

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

        if (!isCurrentGeneration()) {
          // Effect cleanup already tore down shared refs for the newer book;
          // only discard this generation's engine if it somehow survived.
          discardEngine();
          return;
        }

        setIsLoading(false);
      } catch (err) {
        logger.error('Failed to load book:', err);
        if (isCurrentGeneration()) {
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
      activeGeneration = null;
      discardEngine();
      renditionRef.current = null;
      onRenditionCreated?.(null);
    };
  }, [currentBook?.id, currentBook?.filePath]);
}
