import { lazy, Suspense, useState, useCallback, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { AppProvider, useLibrary, useUI } from './stores/AppContext';
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
import type { Book } from './types';
import './index.css';
import './App.css';
import './components/ErrorBoundary.css';

const AIPanel = lazy(() => import('./components/AIPanel').then(mod => ({ default: mod.AIPanel })));
const SettingsPanel = lazy(() => import('./components/SettingsPanel').then(mod => ({ default: mod.SettingsPanel })));

const logger = createLogger('App');
const importLogger = createLogger('Import');

function AppContent() {
  const { addBook, library, updateBookSearchIndex } = useLibrary();
  const { isAIPanelOpen } = useUI();
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

    const existingFilePaths = new Set(library.books.map(b => b.filePath));
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
  }, [isImporting, library.books, addBook, updateBookSearchIndex]);

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
    <AppProvider>
      <AstryxThemeBoundary>
        <AppDialogProvider>
          <AppContent />
        </AppDialogProvider>
      </AstryxThemeBoundary>
    </AppProvider>
  );
}

export default App;
