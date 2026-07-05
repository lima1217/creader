import { lazy, Suspense, useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { preloadEpubReader, Reader } from './components/Reader';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppDialogProvider, useAppDialog } from './components/AppDialog';
import { AstryxThemeBoundary } from './theme/AstryxThemeBoundary';
import { isTauriRuntime } from './utils/tauri';
import { createLogger } from './utils/logger';
import { useUIStore } from './stores/uiStore';
import { useAppLifecycleBootstrap, useAppLifecycleImport } from './appLifecycle';
import { SidebarPanelIcon } from './components/icons/icons';
import './index.css';
import './App.css';
import './components/ErrorBoundary.css';

const AIPanel = lazy(() => import('./components/AIPanel').then(mod => ({ default: mod.AIPanel })));
const SettingsPanel = lazy(() => import('./components/SettingsPanel').then(mod => ({ default: mod.SettingsPanel })));

const logger = createLogger('App');

function AppBootstrap() {
  useAppLifecycleBootstrap();
  return null;
}

function AppContent() {
  const isAIPanelOpen = useUIStore((s) => s.isAIPanelOpen);
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const { notice } = useAppDialog();
  const { isImporting, importBook } = useAppLifecycleImport({ notice });
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
    <div className={`app ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'} ${isDragging ? 'dragging' : ''} ${isImporting ? 'importing' : ''}`}>
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
      <div className="window-sidebar-toggle-region" data-tauri-drag-region>
        <button
          className={`window-sidebar-toggle btn btn-ghost btn-icon ${isSidebarOpen ? 'active' : ''}`}
          onClick={() => setSidebarOpen(!isSidebarOpen)}
          aria-label={isSidebarOpen ? '隐藏侧栏' : '显示侧栏'}
        >
          <SidebarPanelIcon size={22} strokeWidth={1.75} />
        </button>
      </div>
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
