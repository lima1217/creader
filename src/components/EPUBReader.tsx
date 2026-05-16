import { useEffect, useRef, useState } from 'react';
import { Book as EpubBook, Rendition } from 'epubjs';
import { open } from '@tauri-apps/plugin-dialog';
import { useAI, useLibrary, useSettings, useUI, useBookProgress } from '../stores/AppContext';
import type { NavItem } from '../types';
import type { EpubBookLike } from '../services/reader/epubAdapter';
import { tryCopyBookToLibrary } from '../services/BookImportService';
import { createLogger } from '../utils/logger';
import { applyEpubTheme } from './reader/epubTheme';
import { SelectionToolbar } from './reader/SelectionToolbar';
import { useEpubBookLifecycle } from './reader/useEpubBookLifecycle';
import { useEpubProgressTracking } from './reader/useEpubProgressTracking';
import { useEpubSelectionTracking } from './reader/useEpubSelectionTracking';
import { useEpubSearch } from './reader/useEpubSearch';
import { useReaderKeyboardShortcuts } from './reader/useReaderKeyboardShortcuts';
import './EPUBReader.css';
import './SelectionToolbar.css';
import { AILogoIcon, CheckIcon, CopyIcon, PlusIcon as SelectionPlusIcon } from './ai/icons';
import { BookOpenIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, EpubTocIcon, FileIcon, LayersIcon, SearchIcon } from './icons/icons';

const logger = createLogger('EPUBReader');

export function EPUBReader() {
    const { currentBook, updateBookFilePath } = useLibrary();
    const { updateBookProgress } = useBookProgress();
    const { settings } = useSettings();
    const { isSearchOpen, setSearchOpen, setAIPanelOpen } = useUI();
    const {
        currentChapterContent,
        setCurrentChapterContent,
        setSelectedText,
        selectedText,
        setSelectedCfiRange,
        addToAccumulatedTexts,
        accumulatedTexts,
    } = useAI();
    const containerRef = useRef<HTMLDivElement>(null);
    const bookRef = useRef<EpubBook | null>(null);
    const renditionRef = useRef<Rendition | null>(null);
    const bookLikeRef = useRef<EpubBookLike | null>(null);
    const epubScriptsAllowedRef = useRef(false);
    const lastMousePosRef = useRef({ x: 0, y: 0 });
    const [renditionKey, setRenditionKey] = useState(0);

    const [toc, setToc] = useState<NavItem[]>([]);
    const [showToc, setShowToc] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isFileNotFound, setIsFileNotFound] = useState(false);
    const [isRelocating, setIsRelocating] = useState(false);
    const [safeModeBookId, setSafeModeBookId] = useState<string | null>(null);
    const scriptsEnabled = settings.allowEpubScripts === true && safeModeBookId !== currentBook?.id;

    // Search state
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Selection toolbar state
    const [selectionToolbarPos, setSelectionToolbarPos] = useState<{ x: number; y: number } | null>(null);
    const [showSelectionToolbar, setShowSelectionToolbar] = useState(false);
    const [showSelectionHint, setShowSelectionHint] = useState(false);
    const [chapterCopied, setChapterCopied] = useState(false);

    useEffect(() => {
        if (!scriptsEnabled) {
            epubScriptsAllowedRef.current = false;
        }
    }, [scriptsEnabled]);

    useEffect(() => {
        setSafeModeBookId(null);
    }, [currentBook?.id]);

    useEffect(() => {
        setChapterCopied(false);
    }, [currentChapterContent]);

    useEpubBookLifecycle({
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
        onRenditionCreated: () => setRenditionKey(k => k + 1),
    });

    useEpubProgressTracking({
        renditionRef,
        bookLikeRef,
        renditionKey,
        bookId: currentBook?.id ?? null,
        updateBookProgress,
        setCurrentChapterContent,
    });

    useEpubSelectionTracking({
        renditionRef,
        renditionKey,
        containerRef,
        lastMousePosRef,
        setSelectedText,
        setSelectedCfiRange,
        setSelectionToolbarPos,
        setShowSelectionToolbar,
        setShowSelectionHint,
    });

    const {
        searchQuery,
        setSearchQuery,
        searchResults,
        isSearching,
        handleSearch,
        cancelSearch,
        handleSearchResultClick,
    } = useEpubSearch({
        bookRef,
        renditionRef,
        currentBook,
        onCloseSearch: () => setSearchOpen(false),
    });

    useReaderKeyboardShortcuts({
        enabled: Boolean(currentBook),
        isEditableTarget: (target) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement,
        onPrev: () => renditionRef.current?.prev(),
        onNext: () => renditionRef.current?.next(),
        onEscape: () => {
            cancelSearch();
            setSearchOpen(false);
            setShowToc(false);
            setShowSelectionToolbar(false);
        },
        onKey: (e) => {
            if (e.key === 'a' || e.key === 'A') {
                if (selectedText) setAIPanelOpen(true);
            }
        },
    });

    // Update styles when settings change (including theme)
    useEffect(() => {
        if (renditionRef.current) {
            const rendition = renditionRef.current;
            applyEpubTheme(rendition, {
                theme: settings.theme,
                fontFamily: settings.fontFamily,
                fontSize: settings.fontSize,
                lineHeight: settings.lineHeight,
            });

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
        // Hide selection toolbar when navigating
        setShowSelectionToolbar(false);
    };

    const handleNext = () => {
        renditionRef.current?.next();
        // Hide selection toolbar when navigating
        setShowSelectionToolbar(false);
    };

    const handleCopyChapter = async () => {
        if (!currentChapterContent) return;

        try {
            await navigator.clipboard.writeText(currentChapterContent);
            setChapterCopied(true);
            setTimeout(() => setChapterCopied(false), 2000);
        } catch {
            logger.warn('Failed to copy chapter content');
        }
    };

    const handleTocClick = (href: string) => {
        renditionRef.current?.display(href);
        setShowToc(false);
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
                const { finalPath } = await tryCopyBookToLibrary({
                    sourcePath: selected,
                    bookId: currentBook.id,
                });

                // Update the book's file path
                updateBookFilePath(currentBook.id, finalPath);
                // Clear error state to trigger reload
                setError(null);
                setIsFileNotFound(false);
                setSafeModeBookId(null);
            }
        } catch (err) {
            logger.error('Failed to relocate file:', err);
        } finally {
            setIsRelocating(false);
        }
    };

    const handleRetryWithoutScripts = () => {
        if (!currentBook) return;
        setSafeModeBookId(currentBook.id);
        setError(null);
        setIsFileNotFound(false);
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
                            {scriptsEnabled && (
                                <div className="reader-error-actions">
                                    <button className="btn btn-secondary" onClick={handleRetryWithoutScripts}>
                                        Open without scripts
                                    </button>
                                </div>
                            )}
                            <p className="reader-error-hint">
                                Some EPUBs include scripts that can break rendering. Safe mode opens this book without running them.
                            </p>
                        </>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className={`reader ${showToc ? 'toc-open' : ''}`}>
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
                <EpubTocIcon size={18} />
            </button>

            {/* Navigation */}
            <button className="reader-nav reader-nav-prev" onClick={handlePrev}>
                <ChevronLeftIcon />
            </button>

            {/* Book Content */}
            <div ref={containerRef} className="reader-content" />

            <SelectionToolbar
                visible={showSelectionToolbar}
                selectedText={selectedText}
                position={selectionToolbarPos}
                accumulatedCount={accumulatedTexts.length}
                addIcon={<SelectionPlusIcon />}
                askIcon={<AILogoIcon size={14} />}
                closeIcon={<CloseIcon />}
                onAdd={() => {
                    addToAccumulatedTexts(selectedText);
                }}
                onAsk={() => {
                    setAIPanelOpen(true);
                    setShowSelectionToolbar(false);
                }}
                onClose={() => {
                    setShowSelectionToolbar(false);
                    setSelectionToolbarPos(null);
                    setSelectedText('');
                }}
                showHint={showSelectionHint}
            />

            {/* Accumulated Texts Indicator */}
            {accumulatedTexts.length > 0 && (
                <div className="reader-accumulated-indicator">
                    <button
                        className="reader-accumulated-btn"
                        onClick={() => setAIPanelOpen(true)}
                        title={`${accumulatedTexts.length} text(s) accumulated - Click to use with AI`}
                    >
                        <LayersIcon />
                        <span>{accumulatedTexts.length} selected</span>
                    </button>
                    <div className="reader-accumulated-preview">
                        {accumulatedTexts.slice(-3).map((text, idx) => (
                            <div key={idx} className="reader-accumulated-preview-item">
                                {text.slice(0, 60)}{text.length > 60 ? '...' : ''}
                            </div>
                        ))}
                        {accumulatedTexts.length > 3 && (
                            <div className="reader-accumulated-preview-more">
                                +{accumulatedTexts.length - 3} more
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Use Chapter Button - for translating entire chapters */}
            {currentChapterContent && currentChapterContent.length > 100 && (
                <div className="reader-chapter-action">
                    <button
                        className="reader-chapter-btn"
                        onClick={() => {
                            addToAccumulatedTexts(currentChapterContent);
                            setAIPanelOpen(true);
                        }}
                        title="Use current chapter content for AI translation"
                    >
                        <BookOpenIcon size={18} strokeWidth={2} />
                        <span>Use Chapter ({Math.round(currentChapterContent.length / 1000)}k chars)</span>
                    </button>
                    <button
                        className={`reader-chapter-btn reader-chapter-copy ${chapterCopied ? 'copied' : ''}`}
                        onClick={handleCopyChapter}
                        title={chapterCopied ? 'Copied!' : 'Copy chapter content'}
                    >
                        {chapterCopied ? <CheckIcon /> : <CopyIcon />}
                        <span>{chapterCopied ? 'Copied!' : 'Copy Chapter'}</span>
                    </button>
                </div>
            )}

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
