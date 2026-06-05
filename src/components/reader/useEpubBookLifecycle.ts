import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { Book as EpubBook, Rendition } from 'epubjs';
import ePub from 'epubjs';
import { readFile } from '@tauri-apps/plugin-fs';
import type { Settings, Book, NavItem } from '../../types';
import type { EpubBookLike } from '../../services/reader/epubAdapter';
import { generateAndPersistLocations, loadLocationsIfAvailable } from '../../services/reader/locationsCache';
import { setupEpubFontSanitizer } from './epubFontSanitizer';
import { applyEpubTheme } from './epubTheme';
import { createLogger } from '../../utils/logger';
import { isNotFoundErrorMessage, toUserMessage } from '../../utils/errors';
import { perfSpan } from '../../utils/perf';
import { uint8ArrayToArrayBuffer } from '../../utils/arrayBuffer';

const logger = createLogger('useEpubBookLifecycle');

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
  } = params;

  useEffect(() => {
    if (!currentBook || !containerRef.current) return;

    let cancelled = false;
    let fontSanitizerCleanup: (() => void) | null = null;

    const loadBook = async () => {
      setIsLoading(true);
      setError(null);
      setToc([]);

      // Yield to allow the loading UI to paint before heavy work.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (cancelled) return;

      if (bookRef.current) {
        bookRef.current.destroy();
        bookRef.current = null;
      }
      if (renditionRef.current) {
        renditionRef.current = null;
      }
      bookLikeRef.current = null;

      try {
        epubScriptsAllowedRef.current = scriptsEnabled;

        const fileData = await perfSpan('epub:readFile', async () => readFile(currentBook.filePath));
        if (cancelled) return;

        const arrayBuffer = uint8ArrayToArrayBuffer(fileData);

        const book = await perfSpan('epub:parse', async () => {
          const parsed = ePub(arrayBuffer) as unknown as EpubBook;
          await (parsed as any).ready;
          return parsed;
        });

        bookRef.current = book;

        const bookAny = book as unknown as EpubBookLike;
        bookLikeRef.current = bookAny;

        try {
          // Load cached locations if available (fast). Generating locations can be
          // expensive for large books, so defer generation until after first render.
          const loaded = await perfSpan('epub:locations:load', async () => loadLocationsIfAvailable(bookAny, currentBook.id));
          if (!loaded) {
            setTimeout(() => {
              if (cancelled) return;
              void perfSpan('epub:locations:generate', async () => generateAndPersistLocations(bookAny, currentBook.id)).catch(
                (locErr) => {
                  logger.warn('Failed to generate locations, progress may be inaccurate:', locErr);
                }
              );
            }, 400);
          }
        } catch (locErr) {
          logger.warn('Failed to generate locations, progress may be inaccurate:', locErr);
        }

        if (cancelled) return;

        const navigation = bookAny.navigation;
        if (navigation && navigation.toc) {
          const navItems: NavItem[] = navigation.toc.map((item: { id: string; href: string; label: string; subitems?: { id: string; href: string; label: string }[] }) => ({
            id: item.id,
            href: item.href,
            label: item.label,
            subitems: item.subitems?.map((sub: { id: string; href: string; label: string }) => ({
              id: sub.id,
              href: sub.href,
              label: sub.label,
            })),
          }));
          setToc(navItems);
        }

        const container = containerRef.current;
        if (!container) return;

        const rendition = (book as any).renderTo(container, {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: 'paginated',
          allowScriptedContent: scriptsEnabled,
          sandbox: scriptsEnabled ? ['allow-same-origin', 'allow-scripts'] : ['allow-same-origin'],
        }) as Rendition;

        renditionRef.current = rendition;
        if (onRenditionCreated) onRenditionCreated(rendition);
        fontSanitizerCleanup = setupEpubFontSanitizer(rendition, bookAny);

        applyEpubTheme(rendition, {
          theme: settings.theme,
          fontFamily: settings.fontFamily,
          fontSize: settings.fontSize,
          lineHeight: settings.lineHeight,
        });

        if (currentBook.progress.currentCfi) {
          await rendition.display(currentBook.progress.currentCfi);
        } else {
          await rendition.display();
        }

        setIsLoading(false);
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
      if (bookRef.current) {
        bookRef.current.destroy();
        bookRef.current = null;
      }
      renditionRef.current = null;
      bookLikeRef.current = null;
    };
  }, [currentBook?.id, currentBook?.filePath, scriptsEnabled]);
}
