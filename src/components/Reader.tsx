import { useEffect, useRef, useState } from 'react';
import ePub, { Book as EpubBook, Rendition } from 'epubjs';
import { readFile } from '@tauri-apps/plugin-fs';
import { open } from '@tauri-apps/plugin-dialog';
import { useApp } from '../stores/AppContext';
import type { NavItem } from '../types';
import { loadOrGenerateLocations } from '../services/reader/locationsCache';
import { searchBook } from '../services/reader/search';
import type { ReaderSearchResult } from '../services/reader/types';
import {
    PROGRESS_UPDATE_INTERVAL_MS,
    PROGRESS_UPDATE_THRESHOLD_PERCENT,
    CHAPTER_EXTRACT_INTERVAL_MS,
    MAX_CHAPTER_CONTENT_LENGTH
} from '../constants';
import './Reader.css';

// Theme colors for EPUB content
const themeStyles = {
    light: {
        body: {
            color: '#1a1a1a',
            background: '#fdfbf7',
        },
        link: '#2563eb',
    },
    dark: {
        body: {
            color: '#e6edf3',
            background: '#0d1117',
        },
        link: '#58a6ff',
    },
    sepia: {
        body: {
            color: '#3d3531',
            background: '#f4ecd8',
        },
        link: '#8b5a2b',
    },
};

// Icons
const ChevronLeftIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="15 18 9 12 15 6" />
    </svg>
);

const ChevronRightIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

const ListIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
);

const SearchIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
);

const CloseIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

const FileIcon = () => (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
);

export function Reader() {
    const { currentBook, settings, updateBookProgress, updateBookFilePath, isSearchOpen, setSearchOpen, setCurrentChapterContent, setSelectedText, setAIPanelOpen, selectedText } = useApp();
    const containerRef = useRef<HTMLDivElement>(null);
    const bookRef = useRef<EpubBook | null>(null);
    const renditionRef = useRef<Rendition | null>(null);

    const [toc, setToc] = useState<NavItem[]>([]);
    const [showToc, setShowToc] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isFileNotFound, setIsFileNotFound] = useState(false);
    const [isRelocating, setIsRelocating] = useState(false);

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<ReaderSearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const progressStateRef = useRef({ lastTs: 0, lastCfi: '', lastPercentage: 0 });
    const chapterStateRef = useRef({ lastTs: 0, lastCfi: '' });
    const searchTokenRef = useRef(0);

    // Initialize book
    useEffect(() => {
        if (!currentBook || !containerRef.current) return;

        let cancelled = false;

        const loadBook = async () => {
            setIsLoading(true);
            setError(null);
            setToc([]);

            // Clean up previous book
            if (bookRef.current) {
                bookRef.current.destroy();
                bookRef.current = null;
            }
            if (renditionRef.current) {
                renditionRef.current = null;
            }

            try {
                // Read the EPUB file using Tauri's file system API
                const fileData = await readFile(currentBook.filePath);

                if (cancelled) return;

                // Create ArrayBuffer from the file data
                const arrayBuffer = fileData.buffer.slice(
                    fileData.byteOffset,
                    fileData.byteOffset + fileData.byteLength
                );

                // Create epub.js book instance with ArrayBuffer
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const book = ePub(arrayBuffer as any);
                bookRef.current = book;

                await book.ready;

                // Generate locations for accurate progress tracking
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const bookAny = book as any;
                try {
                    await loadOrGenerateLocations(bookAny, currentBook.id);
                } catch (locErr) {
                    console.warn('Failed to generate locations, progress may be inaccurate:', locErr);
                }

                if (cancelled) return;

                // Get TOC
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

                // Render the book
                if (containerRef.current) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const rendition = book.renderTo(containerRef.current, {
                        width: '100%',
                        height: '100%',
                        spread: 'none',
                        flow: 'paginated',
                        allowScriptedContent: settings.allowEpubScripts === true,
                        sandbox: settings.allowEpubScripts === true ? ['allow-same-origin', 'allow-scripts'] : ['allow-same-origin'],
                    } as any);
                    renditionRef.current = rendition;

                    // Apply theme-based styles for comfortable reading
                    const currentTheme = themeStyles[settings.theme];
                    rendition.themes.default({
                        body: {
                            'font-family': `${settings.fontFamily}, Georgia, serif`,
                            'font-size': `${settings.fontSize}px`,
                            'line-height': `${settings.lineHeight}`,
                            'color': `${currentTheme.body.color} !important`,
                            'background': `${currentTheme.body.background} !important`,
                            'padding': '20px !important',
                            'margin': '0 auto !important',
                        },
                        'p': {
                            'margin-bottom': '1em',
                            'color': `${currentTheme.body.color} !important`,
                        },
                        'h1, h2, h3, h4, h5, h6': {
                            'color': `${currentTheme.body.color} !important`,
                        },
                        'a': {
                            'color': `${currentTheme.link} !important`,
                        },
                        'span, div': {
                            'color': `${currentTheme.body.color} !important`,
                        },
                    });

                    // Restore position or start from beginning
                    if (currentBook.progress.currentCfi) {
                        await rendition.display(currentBook.progress.currentCfi);
                    } else {
                        await rendition.display();
                    }

                    // Store book ID for closure
                    const bookId = currentBook.id;

                    // Track location changes using both events for better compatibility
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const handleLocationChange = (location: any) => {
                        if (!location) return;

                        let cfi = '';
                        let percentage = 0;

                        // Extract CFI
                        if (location.start?.cfi) {
                            cfi = location.start.cfi;
                        } else if (typeof location === 'string') {
                            cfi = location;
                        }

                        // Try to get percentage from various sources
                        // Method 1: Direct from location object
                        if (location.start?.percentage !== undefined) {
                            percentage = location.start.percentage * 100;
                        } else if (location.end?.percentage !== undefined) {
                            percentage = location.end.percentage * 100;
                        }

                        // Method 2: Use atEnd flag
                        if (percentage === 0 && location.atEnd) {
                            percentage = 100;
                        }

                        // Method 3: Use locations if available
                        if (percentage === 0 && cfi && bookAny.locations) {
                            try {
                                const locLength = bookAny.locations.length();
                                if (locLength > 0) {
                                    percentage = bookAny.locations.percentageFromCfi(cfi) * 100;
                                }
                            } catch (e) {
                                // Ignore errors
                            }
                        }

                        // Method 4: Use spine position
                        if (percentage === 0 && location.start?.index !== undefined && bookAny.spine) {
                            const spineLength = bookAny.spine.length || bookAny.spine.spineItems?.length || 1;
                            percentage = ((location.start.index + 1) / spineLength) * 100;
                        }

                        if (cfi) {
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
                                updateBookProgress(bookId, cfi, percentage);
                            }
                        }

                        // Extract current chapter content for AI context
                        try {
                            const now = Date.now();
                            const last = chapterStateRef.current;
                            if (now - last.lastTs >= CHAPTER_EXTRACT_INTERVAL_MS && cfi && cfi !== last.lastCfi) {
                                chapterStateRef.current = { lastTs: now, lastCfi: cfi };

                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                const contents = (rendition as any).getContents();
                                if (contents && contents.length > 0) {
                                    const content = contents[0];
                                    if (content && content.document && content.document.body) {
                                        const text = content.document.body.textContent || '';
                                        setCurrentChapterContent(text.slice(0, MAX_CHAPTER_CONTENT_LENGTH));
                                    }
                                }
                            }
                        } catch (e) {
                            console.warn('Failed to extract chapter content:', e);
                        }
                    };

                    rendition.on('locationChanged', handleLocationChange);
                    rendition.on('relocated', handleLocationChange);

                    // Handle text selection for AI context
                    // Method 1: Use epub.js 'selected' event
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    rendition.on('selected', (_cfiRange: any, contents: any) => {
                        try {
                            const selection = contents?.window?.getSelection();
                            if (selection && selection.toString().trim()) {
                                const newSelectedText = selection.toString().trim();
                                setSelectedText(newSelectedText);
                            }
                        } catch (e) {
                            console.warn('Failed to get selection from epub event:', e);
                        }
                    });

                    // Method 2: Listen to each rendered content's mouseup event
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const renditionAny = rendition as any;
                    if (renditionAny.hooks && renditionAny.hooks.content) {
                        renditionAny.hooks.content.register((contents: any) => {
                            try {
                                const doc = contents.document;
                                const win = contents.window;

                                if (doc && win) {
                                    // Listen for mouseup to capture selection
                                    doc.addEventListener('mouseup', () => {
                                        setTimeout(() => {
                                            const selection = win.getSelection();
                                            if (selection && selection.toString().trim()) {
                                                const text = selection.toString().trim();
                                                setSelectedText(text);
                                            }
                                        }, 10); // Small delay to ensure selection is complete
                                    });

                                    // Also listen for selectionchange
                                    doc.addEventListener('selectionchange', () => {
                                        const selection = win.getSelection();
                                        if (selection && selection.toString().trim()) {
                                            const text = selection.toString().trim();
                                            // Only update if significantly different (avoid spam)
                                            if (text.length > 0) {
                                                setSelectedText(text);
                                            }
                                        }
                                    });
                                }
                            } catch (e) {
                                console.warn('Failed to add selection listeners:', e);
                            }
                        });
                    }
                }

                setIsLoading(false);
            } catch (err) {
                console.error('Failed to load book:', err);
                // Log more details about the error
                if (err instanceof Error) {
                    console.error('Error name:', err.name);
                    console.error('Error message:', err.message);
                    console.error('Error stack:', err.stack);
                } else {
                    console.error('Non-Error thrown:', JSON.stringify(err));
                }
                if (!cancelled) {
                    const errorMessage = err instanceof Error
                        ? err.message
                        : (typeof err === 'string' ? err : 'Unknown error');

                    // Check if it's a file not found error
                    const isNotFound = errorMessage.includes('No such file') ||
                        errorMessage.includes('os error 2') ||
                        errorMessage.includes('not found') ||
                        errorMessage.includes('does not exist');

                    setIsFileNotFound(isNotFound);
                    setError(isNotFound
                        ? 'The book file was not found. It may have been moved, renamed, or deleted.'
                        : `Failed to load book: ${errorMessage}`);
                    setIsLoading(false);
                }
            }
        };

        loadBook();

        // Keyboard navigation
        const handleKeyDown = (e: KeyboardEvent) => {
            // Skip if focus is in an input
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }

            if (e.key === 'ArrowLeft') {
                renditionRef.current?.prev();
            } else if (e.key === 'ArrowRight') {
                renditionRef.current?.next();
            } else if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
                e.preventDefault();
                setSearchOpen(true);
                setTimeout(() => searchInputRef.current?.focus(), 50);
            } else if (e.key === 'a' || e.key === 'A') {
                // Open AI panel with selected text
                if (selectedText) {
                    setAIPanelOpen(true);
                }
            } else if (e.key === 'Escape') {
                cancelSearch();
                setSearchOpen(false);
                setShowToc(false);
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            cancelled = true;
            document.removeEventListener('keydown', handleKeyDown);
            if (bookRef.current) {
                bookRef.current.destroy();
                bookRef.current = null;
            }
        };
    }, [currentBook?.id, currentBook?.filePath, settings.allowEpubScripts]);

    // Update styles when settings change (including theme)
    useEffect(() => {
        if (renditionRef.current) {
            const rendition = renditionRef.current;
            const currentTheme = themeStyles[settings.theme];

            // Register the updated theme
            rendition.themes.register('default', {
                body: {
                    'font-family': `${settings.fontFamily} !important`,
                    'font-size': `${settings.fontSize}px !important`,
                    'line-height': `${settings.lineHeight} !important`,
                    'color': `${currentTheme.body.color} !important`,
                    'background': `${currentTheme.body.background} !important`,
                },
                'p': {
                    'color': `${currentTheme.body.color} !important`,
                },
                'h1, h2, h3, h4, h5, h6': {
                    'color': `${currentTheme.body.color} !important`,
                },
                'a': {
                    'color': `${currentTheme.link} !important`,
                },
                'span, div': {
                    'color': `${currentTheme.body.color} !important`,
                },
            });

            // Apply the theme to trigger re-render
            rendition.themes.select('default');

            // Force a re-render of current location to apply styles
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const location = (rendition as any).currentLocation();
            if (location && location.start) {
                rendition.display(location.start.cfi);
            }
        }
    }, [settings.fontSize, settings.fontFamily, settings.lineHeight, settings.theme]);

    // Focus search input when search panel opens
    useEffect(() => {
        if (isSearchOpen) {
            setTimeout(() => searchInputRef.current?.focus(), 50);
        }
    }, [isSearchOpen]);

    const handlePrev = () => {
        renditionRef.current?.prev();
    };

    const handleNext = () => {
        renditionRef.current?.next();
    };

    const handleTocClick = (href: string) => {
        renditionRef.current?.display(href);
        setShowToc(false);
    };

    // Search functionality
    const cancelSearch = () => {
        searchTokenRef.current += 1;
        setIsSearching(false);
    };

    const handleSearch = async () => {
        if (!bookRef.current || !searchQuery.trim()) return;

        const token = ++searchTokenRef.current;
        setIsSearching(true);
        setSearchResults([]);

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const book = bookRef.current as any;
            const results = await searchBook(book, searchQuery, () => token !== searchTokenRef.current);

            if (token === searchTokenRef.current) {
                setSearchResults(results);
            }
        } catch (err) {
            console.error('Search failed:', err);
        } finally {
            if (token === searchTokenRef.current) {
                setIsSearching(false);
            }
        }
    };

    const handleSearchResultClick = (cfi: string) => {
        renditionRef.current?.display(cfi);
        cancelSearch();
        setSearchOpen(false);
    };

    // Handle relocating a book file
    const handleRelocateFile = async () => {
        if (!currentBook || isRelocating) return;

        try {
            setIsRelocating(true);

            const selected = await open({
                multiple: false,
                filters: [{
                    name: 'EPUB',
                    extensions: ['epub']
                }]
            });

            if (selected && typeof selected === 'string') {
                // Update the book's file path
                updateBookFilePath(currentBook.id, selected);
                // Clear error state to trigger reload
                setError(null);
                setIsFileNotFound(false);
            }
        } catch (err) {
            console.error('Failed to relocate file:', err);
        } finally {
            setIsRelocating(false);
        }
    };

    if (!currentBook) {
        return (
            <div className="reader-empty">
                <div className="reader-empty-content">
                    <h2>Welcome to CReader</h2>
                    <p>Select a book from the library or import a new EPUB file to start reading.</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="reader-empty">
                <div className="reader-empty-content">
                    {isFileNotFound ? (
                        <>
                            <FileIcon />
                            <h2>Book File Not Found</h2>
                            <p>{error}</p>
                            <p className="reader-error-path">
                                <strong>Expected path:</strong><br />
                                <code>{currentBook.filePath}</code>
                            </p>
                            <div className="reader-error-actions">
                                <button
                                    className="btn btn-primary"
                                    onClick={handleRelocateFile}
                                    disabled={isRelocating}
                                >
                                    {isRelocating ? 'Selecting...' : 'Locate File'}
                                </button>
                            </div>
                            <p className="reader-error-hint">
                                If you renamed or moved the file, click the button above to locate it again.
                            </p>
                        </>
                    ) : (
                        <>
                            <h2>Error Loading Book</h2>
                            <p>{error}</p>
                        </>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="reader">
            {/* Loading indicator */}
            {isLoading && (
                <div className="reader-loading">
                    <p>Loading book...</p>
                </div>
            )}

            {/* TOC Panel */}
            {showToc && (
                <div className="reader-toc">
                    <div className="reader-toc-header">
                        <h3>Table of Contents</h3>
                        <button className="btn btn-ghost btn-icon" onClick={() => setShowToc(false)}>
                            &times;
                        </button>
                    </div>
                    <ul className="reader-toc-list">
                        {toc.length === 0 ? (
                            <li className="reader-toc-empty">No chapters found</li>
                        ) : (
                            toc.map(item => (
                                <li key={item.id}>
                                    <button
                                        className="reader-toc-item"
                                        onClick={() => handleTocClick(item.href)}
                                    >
                                        {item.label}
                                    </button>
                                    {item.subitems && item.subitems.length > 0 && (
                                        <ul className="reader-toc-sublist">
                                            {item.subitems.map(sub => (
                                                <li key={sub.id}>
                                                    <button
                                                        className="reader-toc-item reader-toc-subitem"
                                                        onClick={() => handleTocClick(sub.href)}
                                                    >
                                                        {sub.label}
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </li>
                            ))
                        )}
                    </ul>
                </div>
            )}

            {/* TOC Toggle */}
            <button
                className="reader-toc-toggle btn btn-ghost btn-icon"
                onClick={() => setShowToc(!showToc)}
                title="Table of Contents"
            >
                <ListIcon />
            </button>

            {/* Navigation */}
            <button className="reader-nav reader-nav-prev" onClick={handlePrev}>
                <ChevronLeftIcon />
            </button>

            {/* Book Content */}
            <div ref={containerRef} className="reader-content" />

            <button className="reader-nav reader-nav-next" onClick={handleNext}>
                <ChevronRightIcon />
            </button>

            {/* Search Panel */}
            {isSearchOpen && (
                <div className="reader-search">
                    <div className="reader-search-header">
                        <div className="reader-search-input-wrapper">
                            <SearchIcon />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                placeholder="Search in book..."
                                className="reader-search-input"
                            />
                        </div>
                        <button className="btn btn-ghost btn-icon" onClick={() => { cancelSearch(); setSearchOpen(false); }}>
                            <CloseIcon />
                        </button>
                    </div>
                    <div className="reader-search-results">
                        {isSearching ? (
                            <div className="reader-search-status">Searching...</div>
                        ) : searchResults.length === 0 && searchQuery ? (
                            <div className="reader-search-status">No results found</div>
                        ) : (
                            searchResults.map((result, index) => (
                                <button
                                    key={index}
                                    className="reader-search-result"
                                    onClick={() => handleSearchResultClick(result.cfi)}
                                >
                                    <span className="reader-search-excerpt">{result.excerpt}</span>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
