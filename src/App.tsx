import { useState, useCallback, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { AppProvider, useApp } from './stores/AppContext';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { Reader } from './components/Reader';
import { AIPanel } from './components/AIPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { extractEpubMetadata } from './utils/epub';
import { saveCover } from './services/CoverStore';
import type { Book } from './types';
import './index.css';
import './App.css';
import './components/ErrorBoundary.css';

function AppContent() {
  const { addBook, library } = useApp();
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Import a book from file path
  const importBook = useCallback(async (filePath: string) => {
    if (isImporting) return;

    // Check if file is already in library
    if (library.books.some(b => b.filePath === filePath)) {
      console.log('Book already in library:', filePath);
      return;
    }

    try {
      setIsImporting(true);

      // Generate book ID first
      const bookId = Date.now().toString();

      // Copy the file to the app's books directory
      let finalPath = filePath;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<{ new_path: string; book_id: string }>('import_book_to_library', {
          sourcePath: filePath,
          bookId: bookId,
        });
        finalPath = result.new_path;
        console.log('Book copied to:', finalPath);
      } catch (copyError) {
        console.warn('Failed to copy book to library, using original path:', copyError);
        // Continue with original path as fallback
      }

      // Extract metadata from EPUB (use the final path)
      const metadata = await extractEpubMetadata(finalPath);

      let coverKey: string | undefined;
      if (metadata.coverBlob) {
        try {
          await saveCover(bookId, metadata.coverBlob);
          coverKey = bookId;
        } catch (e) {
          console.error('Failed to persist cover:', e);
        }
      }

      const newBook: Book = {
        id: bookId,
        title: metadata.title,
        author: metadata.author,
        coverKey,
        filePath: finalPath,
        addedAt: Date.now(),
        progress: {
          currentCfi: '',
          percentage: 0,
        },
      };

      addBook(newBook);
    } catch (error) {
      console.error('Failed to import book:', error);
    } finally {
      setIsImporting(false);
    }
  }, [isImporting, library.books, addBook]);

  // Handle file dialog import
  const handleImportBook = async () => {
    if (isImporting) return;

    try {
      // Use Tauri dialog to select file
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'EPUB',
          extensions: ['epub']
        }]
      });

      if (selected && typeof selected === 'string') {
        await importBook(selected);
      }
    } catch (error) {
      console.error('Failed to open file dialog:', error);
    }
  };

  // Setup drag and drop listeners for Tauri
  useEffect(() => {
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
              // Filter for .epub files
              const epubFiles = paths.filter((p: string) => p.toLowerCase().endsWith('.epub'));
              if (epubFiles.length > 0) {
                importBook(epubFiles[0]);
              }
            }
          }
        });
      } catch (error) {
        console.error('Failed to setup drag-drop:', error);
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
            <div className="loading-spinner" />
            <p>Importing book...</p>
          </div>
        </div>
      )}
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-content">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p>Drop EPUB file here</p>
          </div>
        </div>
      )}
      <div className="app-body">
        <ErrorBoundary>
          <Sidebar onImportBook={handleImportBook} />
        </ErrorBoundary>
        <div className="app-main">
          <Toolbar />
          <ErrorBoundary>
            <Reader />
          </ErrorBoundary>
        </div>
        <ErrorBoundary>
          <AIPanel />
        </ErrorBoundary>
      </div>
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;
