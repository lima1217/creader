import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { Book as EpubBook, Rendition } from 'epubjs';
import { readFile } from '@tauri-apps/plugin-fs';
import type { Settings, Book, NavItem } from '../../types';
import type { EpubBookLike } from '../../services/reader/epubAdapter';
import { generateAndPersistLocations, loadLocationsIfAvailable } from '../../services/reader/locationsCache';
import { setupEpubFontSanitizer } from './epubFontSanitizer';
import { applyEpubTheme } from './epubTheme';
import { epubjsEngineAdapter } from '../../services/reader/epubjsEngine';
import { foliateEngineAdapter } from '../../services/reader/foliateEngine';
import type { ReadingEngineInstance } from '../../services/reader/readingEngine';
import { createLogger } from '../../utils/logger';
import { isNotFoundErrorMessage, toUserMessage } from '../../utils/errors';
import { perfSpan } from '../../utils/perf';
import { uint8ArrayToArrayBuffer } from '../../utils/arrayBuffer';

const logger = createLogger('useEpubBookLifecycle');

/**
 * Open the book through the reader-engine adapter layer.
 *
 * Per the design doc (`docs/reading-engine-adapter.md`) foliate-js is the
 * preferred engine; if it fails to open the book we fall back to the epubjs
 * adapter so reading still works and scripted-EPUB "safe mode" remains
 * meaningful as a fallback path.
 */
async function openReader(
  appBook: Book,
  arrayBuffer: ArrayBuffer,
  container: HTMLElement,
  scriptsEnabled: boolean,
): Promise<ReadingEngineInstance> {
  try {
    return await foliateEngineAdapter.open({ appBook, arrayBuffer, container, scriptsEnabled });
  } catch (err) {
    logger.warn('foliate failed to open the book, falling back to epubjs:', err);
    // foliate may have inserted a <foliate-view> before failing — clear it so
    // the epubjs adapter renders into a clean container.
    container.replaceChildren();
    return epubjsEngineAdapter.open({ appBook, arrayBuffer, container, scriptsEnabled });
  }
}

export function useEpubBookLifecycle(params: {
  currentBook: Book | null;
  containerRef: RefObject<HTMLDivElement | null>;
  settings: Settings;
  scriptsEnabled: boolean;
  epubScriptsAllowedRef: RefObject<boolean>;
  bookRef: RefObject<EpubBook | null>;
  renditionRef: RefObject<Rendition | null>;
  bookLikeRef: RefObject<EpubBookLike | null>;
  setToc: (toc: NavItem[]) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setIsFileNotFound: (isNotFound: boolean) => void;
  onRenditionCreated?: (rendition: Rendition) => void;
  onLocationsResolved?: (available: boolean) => void;
}) {
  const {
    currentBook,
    containerRef,
    settings,
    scriptsEnabled,
    epubScriptsAllowedRef,
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
    let fontSanitizerCleanup: (() => void) | null = null;
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
        epubScriptsAllowedRef.current = scriptsEnabled;

        const fileData = await perfSpan('epub:readFile', async () => readFile(currentBook.filePath));
        if (cancelled) return;

        const arrayBuffer = uint8ArrayToArrayBuffer(fileData);

        const container = containerRef.current;
        if (!container || cancelled) return;

        engineInstance = await perfSpan('epub:open', async () =>
          openReader(currentBook, arrayBuffer, container, scriptsEnabled),
        );
        if (cancelled) {
          engineInstance.destroy();
          engineInstance = null;
          return;
        }

        const { rendition, bookLike, toc } = engineInstance;
        renditionRef.current = rendition;
        bookLikeRef.current = bookLike;
        // The epubjs `Book` isn't surfaced by every adapter; keep a destroyable
        // handle on `bookRef` so existing teardown paths still work for both
        // engines. The only consumer of this ref is the lifecycle itself.
        bookRef.current = { destroy: () => engineInstance?.destroy() } as unknown as EpubBook;

        setToc(toc);
        if (onRenditionCreated) onRenditionCreated(rendition);

        // The font sanitizer hooks epubjs spine/content lifecycle; foliate uses
        // a different loader model with no epubjs hooks, so it stays epubjs-only.
        if (engineInstance.name === 'epubjs') {
          fontSanitizerCleanup = setupEpubFontSanitizer(rendition, bookLike);
        }

        applyEpubTheme(rendition, {
          theme: settings.theme,
          fontFamily: settings.fontFamily,
          fontSize: settings.fontSize,
          lineHeight: settings.lineHeight,
        });

        const startTarget = currentBook.progress.currentCfi || undefined;
        await perfSpan('epub:firstDisplay', async () => rendition.display(startTarget));

        setIsLoading(false);

        // Locations improve percentage accuracy but are not needed to show the
        // requested chapter. Restore/generate them only after the first page is
        // visible — and only for epubjs, which reports `locationsAvailable:
        // false`. foliate reports progress from its own section fraction and
        // already declares `locationsAvailable: true`, so there is nothing to
        // generate.
        if (engineInstance.name === 'epubjs' && !engineInstance.locationsAvailable) {
          const restoreLocations = async () => {
            try {
              const loaded = await perfSpan('epub:locations:load', async () => loadLocationsIfAvailable(bookLike, currentBook.id));
              if (cancelled) return;
              if (loaded) {
                onLocationsResolved?.(true);
                return;
              }
              await new Promise<void>((resolve) => setTimeout(resolve, 400));
              if (cancelled) return;
              const generated = await perfSpan('epub:locations:generate', async () => generateAndPersistLocations(bookLike, currentBook.id));
              if (!cancelled) onLocationsResolved?.(generated);
            } catch (locErr) {
              logger.warn('Failed to restore locations, progress may be inaccurate:', locErr);
              if (!cancelled) onLocationsResolved?.(false);
            }
          };
          void restoreLocations();
        } else {
          // foliate (or any engine that supplies its own progress) is ready
          // immediately.
          onLocationsResolved?.(true);
        }
      } catch (err) {
        logger.error('Failed to load book:', err);
        if (!cancelled) {
          const errorMessage = err instanceof Error ? err.message : (typeof err === 'string' ? err : '未知错误');
          const isNotFound = isNotFoundErrorMessage(errorMessage);
          setIsFileNotFound(isNotFound);
          setError(isNotFound ? toUserMessage(errorMessage) : `无法打开书籍：${errorMessage}`);
          setIsLoading(false);
        }
      }
    };

    void loadBook();

    return () => {
      cancelled = true;
      if (fontSanitizerCleanup) {
        fontSanitizerCleanup();
        fontSanitizerCleanup = null;
      }
      if (engineInstance) {
        engineInstance.destroy();
        engineInstance = null;
      }
      renditionRef.current = null;
      bookLikeRef.current = null;
      bookRef.current = null;
    };
  }, [currentBook?.id, currentBook?.filePath, scriptsEnabled]);
}
