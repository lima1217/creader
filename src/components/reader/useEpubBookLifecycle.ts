import { useEffect } from 'react';
import type { RefObject } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import type { Settings, Book, NavItem } from '../../types';
import type { EpubBookLike, ReaderRendition } from '../../services/reader/epubAdapter';
import { applyEpubTheme } from './epubTheme';
import { foliateEngineAdapter } from '../../services/reader/foliateEngine';
import type { ReadingEngineInstance } from '../../services/reader/readingEngine';
import { createLogger } from '../../utils/logger';
import { isNotFoundErrorMessage, toUserMessage } from '../../utils/errors';
import { perfSpan } from '../../utils/perf';
import { uint8ArrayToArrayBuffer } from '../../utils/arrayBuffer';

const logger = createLogger('useEpubBookLifecycle');

function unsupportedBookMessage(): string {
  return '无法打开书籍：这本 EPUB 可能使用了 CReader 当前不支持的格式或脚本内容。请尝试换一本标准 EPUB 文件。';
}

export function useEpubBookLifecycle(params: {
  currentBook: Book | null;
  containerRef: RefObject<HTMLDivElement | null>;
  settings: Settings;
  bookRef: RefObject<EpubBookLike | null>;
  renditionRef: RefObject<ReaderRendition | null>;
  bookLikeRef: RefObject<EpubBookLike | null>;
  setToc: (toc: NavItem[]) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setIsFileNotFound: (isNotFound: boolean) => void;
  onRenditionCreated?: (rendition: ReaderRendition) => void;
  onLocationsResolved?: (available: boolean) => void;
}) {
  const {
    currentBook,
    containerRef,
    settings,
    bookRef,
    renditionRef,
    bookLikeRef,
    setToc,
    setIsLoading,
    setError,
    setIsFileNotFound,
    onRenditionCreated,
    onLocationsResolved,
  } = params;

  useEffect(() => {
    if (!currentBook || !containerRef.current) return;

    let cancelled = false;
    let engineInstance: ReadingEngineInstance | null = null;

    const loadBook = async () => {
      setIsLoading(true);
      setError(null);
      setToc([]);

      // Yield to allow the loading UI to paint before heavy work.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (cancelled) return;

      if (engineInstance) {
        engineInstance.destroy();
        engineInstance = null;
      }
      renditionRef.current = null;
      bookLikeRef.current = null;
      bookRef.current = null;

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

        const { rendition, bookLike, toc } = engineInstance;
        renditionRef.current = rendition;
        bookLikeRef.current = bookLike;
        bookRef.current = { destroy: () => engineInstance?.destroy() };

        setToc(toc);
        if (onRenditionCreated) onRenditionCreated(rendition);

        applyEpubTheme(rendition, {
          theme: settings.theme,
          fontFamily: settings.fontFamily,
          fontSize: settings.fontSize,
          lineHeight: settings.lineHeight,
        });

        const startTarget = currentBook.progress.currentCfi || undefined;
        await perfSpan('epub:firstDisplay', async () => rendition.display(startTarget));

        setIsLoading(false);
        onLocationsResolved?.(engineInstance.locationsAvailable);
      } catch (err) {
        logger.error('Failed to load book:', err);
        if (!cancelled) {
          const errorMessage = err instanceof Error ? err.message : (typeof err === 'string' ? err : '未知错误');
          const isNotFound = isNotFoundErrorMessage(errorMessage);
          setIsFileNotFound(isNotFound);
          setError(isNotFound ? toUserMessage(errorMessage) : unsupportedBookMessage());
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
      bookLikeRef.current = null;
      bookRef.current = null;
    };
  }, [currentBook?.id, currentBook?.filePath]);
}
