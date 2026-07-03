import { lazy, Suspense, useState, useCallback, useEffect, useRef } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { preloadEpubReader, Reader } from './components/Reader';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppDialogProvider, useAppDialog } from './components/AppDialog';
import { AstryxThemeBoundary } from './theme/AstryxThemeBoundary';
import { importBookFromPath } from './services/BookImportService';
import { rebuildSearchIndexQuietly, toSearchIndexSummary } from './services/reader/searchIndex';
import { isTauriRuntime } from './utils/tauri';
import { createLogger } from './utils/logger';
import { perfSpan } from './utils/perf';
import { useDebouncedPersist } from './hooks/useDebouncedPersist';
import { STORAGE_KEYS, loadStored } from './services/LocalStore';
import { validateAndFixLibraryPaths } from './services/BookPathValidator';
import { dataUrlToBlob, saveCover } from './services/CoverStore';
import {
  loadChatMessages,
  loadConversationMemory,
  replaceChatMessages,
} from './services/ChatStore';
import { MAX_CHAT_MESSAGES_STORED } from './constants';
import { useUIStore } from './stores/uiStore';
import { useLibraryStore, getLatestCurrentBook, getLatestLibrary } from './stores/libraryStore';
import { useSettingsStore } from './stores/settingsStore';
import { useProgressStore } from './stores/progressStore';
import { hydrateChatMessages, hydrateConversationMemory } from './stores/aiStore';
import type { Book, ChatMessage } from './types';
import './index.css';
import './App.css';
import './components/ErrorBoundary.css';

const AIPanel = lazy(() => import('./components/AIPanel').then(mod => ({ default: mod.AIPanel })));
const SettingsPanel = lazy(() => import('./components/SettingsPanel').then(mod => ({ default: mod.SettingsPanel })));

const logger = createLogger('App');
const importLogger = createLogger('Import');
const bootstrapLogger = createLogger('Bootstrap');

/**
 * One-shot startup effects that previously lived inside `AppProvider`.
 *
 * Renders nothing — it just owns the debounced persistence writes and the
 * idle-scheduled migration / hydration side effects (theme application,
 * library + progress + settings persistence, cover migration, path validation,
 * chat hydration from Dexie). Reads state from the Zustand stores directly.
 */
function AppBootstrap() {
  const settings = useSettingsStore((s) => s.settings);
  const library = useLibraryStore((s) => s.library);
  const bookProgressById = useProgressStore((s) => s.bookProgressById);

  // Apply theme to the root element so native chrome stays in sync
  // with the Astryx `data-astryx-theme`/`data-theme` driven by the boundary.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  useDebouncedPersist(STORAGE_KEYS.settings, settings, 500, { skipInitial: true });
  useDebouncedPersist(STORAGE_KEYS.library, library, 800, { skipInitial: true });
  useDebouncedPersist(STORAGE_KEYS.progress, bookProgressById, 800, { skipInitial: true });

  // Migrate any books still carrying inline data: URLs into the cover store.
  useEffect(() => {
    let cancelled = false;

    const toMigrate = library.books.filter(b => !!b.cover && b.cover.startsWith('data:') && !b.coverKey);
    if (toMigrate.length === 0) return;

    const migrateCovers = async () => {
      await perfSpan('startup:migrateCovers', async () => {
        const migratedIds = new Set<string>();
        for (const book of toMigrate) {
          if (cancelled) return;
          try {
            const blob = await dataUrlToBlob(book.cover as string);
            await saveCover(book.id, blob);
            migratedIds.add(book.id);
          } catch (e) {
            bootstrapLogger.error('Failed to migrate cover:', e);
          }
        }

        if (cancelled) return;
        if (migratedIds.size > 0) {
          useLibraryStore.setState((state) => ({
            library: {
              ...state.library,
              books: state.library.books.map(b => migratedIds.has(b.id) ? { ...b, cover: undefined, coverKey: b.id } : b),
              lastUpdated: Date.now(),
            },
          }));
        }
      });
    };

    const scheduleIdle = () => {
      const w = window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (handle: number) => void;
      };

      if (typeof w.requestIdleCallback === 'function') {
        const handle = w.requestIdleCallback(() => void migrateCovers(), { timeout: 3500 });
        return () => w.cancelIdleCallback?.(handle);
      }

      const timer = window.setTimeout(() => void migrateCovers(), 1200);
      return () => window.clearTimeout(timer);
    };

    const cancelSchedule = scheduleIdle();

    return () => {
      cancelled = true;
      cancelSchedule();
    };
  }, [library.books]);

  // Validate and fix book paths on startup (important for packaged apps).
  const pathValidationRan = useRef(false);
  useEffect(() => {
    // Only run once on startup
    if (pathValidationRan.current) return;
    pathValidationRan.current = true;

    let cancelled = false;

    const validatePaths = async () => {
      const snapshot = getLatestLibrary();
      if (!snapshot || snapshot.books.length === 0) return;

      try {
        const result = await perfSpan('startup:validateAndFixLibraryPaths', async () => {
          return await validateAndFixLibraryPaths(snapshot);
        });

        if (cancelled) return;

        if (result.fixedBooks.length > 0) {
          bootstrapLogger.debug(`Fixed paths for ${result.fixedBooks.length} book(s)`);
        }
        if (result.brokenBooks.length > 0) {
          bootstrapLogger.warn(`Could not find files for ${result.brokenBooks.length} book(s)`);
        }

        if (result.fixedBooks.length > 0) {
          useLibraryStore.setState((state) => {
            // Don't clobber state if the library changed while we were validating.
            if (state.library.lastUpdated !== snapshot.lastUpdated) return state;
            return { library: result.updatedLibrary };
          });

          const current = getLatestCurrentBook();
          if (current && result.fixedBooks.includes(current.id)) {
            const updated = result.updatedLibrary.books.find(b => b.id === current.id);
            if (updated && updated.filePath !== current.filePath) {
              useLibraryStore.setState((state) => ({
                currentBook: state.currentBook?.id === current.id
                  ? { ...state.currentBook, filePath: updated.filePath }
                  : state.currentBook,
              }));
            }
          }
        }
      } catch (error) {
        bootstrapLogger.error('Failed to validate book paths:', error);
      }
    };

    const scheduleIdle = () => {
      const w = window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (handle: number) => void;
      };

      if (typeof w.requestIdleCallback === 'function') {
        const handle = w.requestIdleCallback(() => void validatePaths(), { timeout: 2000 });
        return () => w.cancelIdleCallback?.(handle);
      }

      const timer = window.setTimeout(() => void validatePaths(), 1200);
      return () => window.clearTimeout(timer);
    };

    const cancelSchedule = scheduleIdle();

    return () => {
      cancelled = true;
      cancelSchedule();
    };
  }, []);

  // Hydrate conversation memory from Dexie once on startup.
  useEffect(() => {
    if (typeof indexedDB === 'undefined') return;
    let cancelled = false;
    loadConversationMemory()
      .then(memory => {
        if (!cancelled) hydrateConversationMemory(memory);
      })
      .catch(e => {
        bootstrapLogger.warn('Failed to load conversation memory:', e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hydrate chat messages from Dexie (with legacy localStorage-chat migration).
  useEffect(() => {
    if (typeof indexedDB === 'undefined') return;
    let cancelled = false;

    const hydrateChat = async () => {
      try {
        const stored = await loadChatMessages(MAX_CHAT_MESSAGES_STORED);
        if (cancelled) return;

        if (stored.length > 0) {
          hydrateChatMessages(stored);
          return;
        }

        // Migrate legacy localStorage chat once.
        const legacy = loadStored<ChatMessage[]>(STORAGE_KEYS.chat, []);
        if (legacy.length > 0) {
          const trimmed = legacy.slice(-MAX_CHAT_MESSAGES_STORED);
          await replaceChatMessages(trimmed, MAX_CHAT_MESSAGES_STORED);
          localStorage.removeItem(STORAGE_KEYS.chat);
          if (!cancelled) hydrateChatMessages(trimmed);
        }
      } catch (error) {
        bootstrapLogger.warn('Failed to hydrate chat messages:', error);
      }
    };

    // Defer so initial reader UI can settle first.
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const cancel = (() => {
      if (typeof w.requestIdleCallback === 'function') {
        const handle = w.requestIdleCallback(() => void hydrateChat(), { timeout: 1500 });
        return () => w.cancelIdleCallback?.(handle);
      }
      const timer = window.setTimeout(() => void hydrateChat(), 600);
      return () => window.clearTimeout(timer);
    })();

    return () => {
      cancelled = true;
      cancel();
    };
  }, []);

  return null;
}

function AppContent() {
  const addBook = useLibraryStore((s) => s.addBook);
  const libraryBooks = useLibraryStore((s) => s.library.books);
  const updateBookSearchIndex = useLibraryStore((s) => s.updateBookSearchIndex);
  const isAIPanelOpen = useUIStore((s) => s.isAIPanelOpen);
  const { notice } = useAppDialog();
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [hasLoadedAIPanel, setHasLoadedAIPanel] = useState(isAIPanelOpen);
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);

  useEffect(() => {
    if (isAIPanelOpen) setHasLoadedAIPanel(true);
  }, [isAIPanelOpen]);

  useEffect(() => {
    if (isSettingsOpen) setHasLoadedSettings(true);
  }, [isSettingsOpen]);

  // Import a book from file path
  const importBook = useCallback(async (filePath: string) => {
    if (isImporting) return;

    const existingFilePaths = new Set(libraryBooks.map(b => b.filePath));
    if (existingFilePaths.has(filePath)) {
      importLogger.debug('Book already in library:', filePath);
      return;
    }

    try {
      setIsImporting(true);
      importLogger.debug('Starting import process for:', filePath);

      const result = await importBookFromPath({
        filePath,
        existingFilePaths,
      });
      if (result.status === 'skipped') {
        importLogger.debug('Import skipped:', result.reason);
        return;
      }

      const newBook: Book = { ...result.book, searchIndex: { state: 'pending' } };
      importLogger.debug('Adding book to library:', newBook);
      addBook(newBook);
      void rebuildSearchIndexQuietly({
        bookId: newBook.id,
        filePath: newBook.filePath,
        onStatus: status => updateBookSearchIndex(newBook.id, toSearchIndexSummary(status)),
      });
      importLogger.debug('Import completed successfully');
    } catch (error) {
      importLogger.error('Failed to import book:', error);
      if (error instanceof Error) importLogger.debug('Error details:', error.message, error.stack);
      notice({
        title: '无法导入 EPUB',
        message: error instanceof Error ? error.message : '未知错误',
      });
    } finally {
      setIsImporting(false);
    }
  }, [isImporting, libraryBooks, addBook, updateBookSearchIndex]);

  // Handle file dialog import
  const handleImportBook = async () => {
    if (isImporting) return;

    try {
      // Use Tauri dialog to select file
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'EPUB books',
          extensions: ['epub']
        }]
      });

      if (selected && typeof selected === 'string') {
        await importBook(selected);
      }
    } catch (error) {
      logger.error('Failed to open file dialog:', error);
    }
  };

  // Setup drag and drop listeners for Tauri
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;

    const setupDragDrop = async () => {
      try {
        const webview = getCurrentWebviewWindow();

        // Listen for file drop events
        unlisten = await webview.onDragDropEvent((event) => {
          if (event.payload.type === 'enter' || event.payload.type === 'over') {
            setIsDragging(true);
          } else if (event.payload.type === 'leave') {
            setIsDragging(false);
          } else if (event.payload.type === 'drop') {
            setIsDragging(false);
            const paths = event.payload.paths;
            if (paths && paths.length > 0) {
              // Filter for supported file types
              const supportedFiles = paths.filter((p: string) => {
                const lower = p.toLowerCase();
                return lower.endsWith('.epub');
              });
              if (supportedFiles.length > 0) {
                importBook(supportedFiles[0]);
              }
            }
          }
        });
      } catch (error) {
        logger.error('Failed to setup drag-drop:', error);
      }
    };

    setupDragDrop();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [importBook]);

  return (
    <div className={`app ${isDragging ? 'dragging' : ''} ${isImporting ? 'importing' : ''}`}>
      {/* Import Loading Overlay */}
      {isImporting && (
        <div className="import-overlay">
          <div className="import-overlay-content">
            <div className="import-book-mark" aria-hidden="true" />
            <p>正在加入书库</p>
            <span>读取封面、书名和作者。</span>
          </div>
        </div>
      )}
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-content">
            <div className="drop-book-stack" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p>松开后导入 EPUB</p>
            <span className="drop-overlay-hint">CReader 只会加入 .epub 文件</span>
          </div>
        </div>
      )}
      <div className="app-body">
        <ErrorBoundary>
          <Sidebar
            onImportBook={handleImportBook}
            onOpenSettings={() => setSettingsOpen(true)}
            onPreloadReader={preloadEpubReader}
          />
          {(isSettingsOpen || hasLoadedSettings) && (
            <Suspense fallback={null}>
              <SettingsPanel isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />
            </Suspense>
          )}
        </ErrorBoundary>
        <div className="app-main">
          <Toolbar />
          <ErrorBoundary>
            <Reader />
          </ErrorBoundary>
        </div>
        <ErrorBoundary>
          {(isAIPanelOpen || hasLoadedAIPanel) && (
            <Suspense fallback={null}>
              <AIPanel />
            </Suspense>
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}

function App() {
  return (
    <AstryxThemeBoundary>
      <AppBootstrap />
      <AppDialogProvider>
        <AppContent />
      </AppDialogProvider>
    </AstryxThemeBoundary>
  );
}

export default App;
