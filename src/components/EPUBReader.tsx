import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useLibraryStore } from '../stores/libraryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { useProgressStore } from '../stores/progressStore';
import { useAIStore } from '../stores/aiStore';
import { useSelectionStore } from '../stores/selectionStore';
import type { Book, NavItem } from '../types';
import type { EpubBookLike, ReaderRendition } from '../services/reader/epubAdapter';
import { tryCopyBookToLibrary } from '../services/BookImportService';
import { rebuildSearchIndexQuietly, toSearchIndexSummary } from '../services/reader/searchIndex';
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

function searchIndexMessage(state: string, error?: string): string {
    switch (state) {
        case 'pending':
            return '搜索索引正在构建，稍后即可搜索。';
        case 'failed':
            return error || '搜索索引构建失败，可以重试。';
        case 'stale':
            return '书籍文件已变化，需要重建搜索索引。';
        case 'missing':
            return '这本书还没有搜索索引。';
        default:
            return '';
    }
}

export function EPUBReader() {
    const currentBook = useLibraryStore((s) => s.currentBook);
    const updateBookFilePath = useLibraryStore((s) => s.updateBookFilePath);
    const updateBookSearchIndex = useLibraryStore((s) => s.updateBookSearchIndex);
    const updateBookProgress = useProgressStore((s) => s.updateBookProgress);
    const settings = useSettingsStore((s) => s.settings);
    const isSearchOpen = useUIStore((s) => s.isSearchOpen);
    const setSearchOpen = useUIStore((s) => s.setSearchOpen);
    const setAIPanelOpen = useUIStore((s) => s.setAIPanelOpen);
    const currentChapterContent = useAIStore((s) => s.currentChapterContent);
    const setCurrentChapterContent = useAIStore((s) => s.setCurrentChapterContent);
    const setSelectedText = useSelectionStore((s) => s.setSelectedText);
    const selectedText = useSelectionStore((s) => s.selectedText);
    const setSelectedCfiRange = useSelectionStore((s) => s.setSelectedCfiRange);
    const addToAccumulatedTexts = useSelectionStore((s) => s.addToAccumulatedTexts);
    const accumulatedTexts = useSelectionStore((s) => s.accumulatedTexts);
    const containerRef = useRef<HTMLDivElement>(null);
    const bookRef = useRef<EpubBookLike | null>(null);
    const renditionRef = useRef<ReaderRendition | null>(null);
    const bookLikeRef = useRef<EpubBookLike | null>(null);
    const lastMousePosRef = useRef({ x: 0, y: 0 });
    const [renditionKey, setRenditionKey] = useState(0);
    const [toc, setToc] = useState<NavItem[]>([]);
    const [showToc, setShowToc] = useState(false);
    // Active TOC href for "you are here" highlighting. Updated whenever the
    // reader relocates, derived from the rendition's current location start.
    const [currentTocHref, setCurrentTocHref] = useState<string>('');

    // Map a spine href to a human-readable chapter label, so search results can
    // show a real chapter title instead of the raw OPF idref / href. Flattens
    // nested TOC entries and normalizes anchor + path prefixes.
    const chapterLabelByHref = useMemo(() => {
        const map = new Map<string, string>();
        const normalize = (href: string) => (href || '').split('#')[0].trim();
        const walk = (items: NavItem[]) => {
            for (const item of items) {
                const key = normalize(item.href);
                if (key && item.label && !map.has(key)) map.set(key, item.label);
                if (item.subitems?.length) walk(item.subitems);
            }
        };
        walk(toc);
        return map;
    }, [toc]);

    const resolveChapterLabel = useCallback((result: { section?: string; cfi?: string }) => {
        // Prefer resolving via the result's href (carried on `cfi` in the slow
        // path); fall back to the existing `section` if it is already a title.
        const href = (result.cfi || '').split('#')[0].trim();
        const viaHref = href ? chapterLabelByHref.get(href) : undefined;
        if (viaHref) return viaHref;
        const section = result.section || '';
        // Heuristic: `section` can be a spine idref (e.g. "id123") or a
        // filename ("x.xhtml") when no label exists. Only show it when it looks
        // like a real title rather than a raw id/filename.
        if (section && !/^(id\d+|.*\.(x?html|htm|xhtml))$/i.test(section)) return section;
        return '';
    }, [chapterLabelByHref]);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isFileNotFound, setIsFileNotFound] = useState(false);
    const [isRelocating, setIsRelocating] = useState(false);

    // Search state
    const searchInputRef = useRef<HTMLInputElement>(null);
    const handleSearchIndexStatus = useCallback((status: NonNullable<Book['searchIndex']>) => {
        if (currentBook) updateBookSearchIndex(currentBook.id, status);
    }, [currentBook, updateBookSearchIndex]);

    // Selection toolbar state
    const [selectionToolbarPos, setSelectionToolbarPos] = useState<{ x: number; y: number } | null>(null);
    const [showSelectionToolbar, setShowSelectionToolbar] = useState(false);
    const [showSelectionHint, setShowSelectionHint] = useState(false);
    const [chapterCopied, setChapterCopied] = useState(false);
    // Accumulated-texts preview: toggled by click so it works on touch devices,
    // while hover still reveals it on desktop.
    const [accumulatedPreviewOpen, setAccumulatedPreviewOpen] = useState(false);

    useEffect(() => {
        setChapterCopied(false);
    }, [currentChapterContent]);

    useEpubBookLifecycle({
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

    // Track the active TOC href so the table of contents can highlight the
    // chapter the reader is currently on.
    useEffect(() => {
        const rendition = renditionRef.current;
        if (!rendition) return;

        const updateHref = () => {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const loc = (rendition as any).currentLocation?.();
                const href = loc?.start?.href;
                if (typeof href === 'string') setCurrentTocHref(href);
            } catch {
                // currentLocation can throw before the book is fully laid out.
            }
        };

        updateHref();
        rendition.on('relocated', updateHref);
        rendition.on('locationChanged', updateHref);
        return () => {
            rendition.off('relocated', updateHref);
            rendition.off('locationChanged', updateHref);
        };
    }, [renditionKey]);

    const {
        searchQuery,
        setSearchQuery,
        searchResults,
        isSearching,
        isRebuildingIndex,
        searchError,
        handleSearch,
        refreshIndexStatus,
        rebuildCurrentIndex,
        cancelSearch,
        handleSearchResultClick,
    } = useEpubSearch({
        renditionRef,
        currentBook,
        onSearchIndexStatus: handleSearchIndexStatus,
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
            void refreshIndexStatus().catch(err => logger.warn('Failed to refresh search index status:', err));
        }
    }, [isSearchOpen, refreshIndexStatus]);

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
                void rebuildSearchIndexQuietly({
                    bookId: currentBook.id,
                    filePath: finalPath,
                    onStatus: status => updateBookSearchIndex(currentBook.id, toSearchIndexSummary(status)),
                });
                // Clear error state to trigger reload
                setError(null);
                setIsFileNotFound(false);
            }
        } catch (err) {
            logger.error('Failed to relocate file:', err);
        } finally {
            setIsRelocating(false);
        }
    };

    if (!currentBook) {
        return (
            <div className="reader-empty">
                <div className="reader-empty-content">
                    <h2>选择一本书开始阅读</h2>
                    <p>从左侧书库打开 EPUB，或导入一本新书。</p>
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
                            <h2>找不到书籍文件</h2>
                            <p>{error}</p>
                            <p className="reader-error-path">
                                <strong>原文件路径：</strong><br />
                                <code>{currentBook.filePath}</code>
                            </p>
                            <div className="reader-error-actions">
                                <button
                                    className="btn btn-primary"
                                    onClick={handleRelocateFile}
                                    disabled={isRelocating}
                                >
                                    {isRelocating ? '正在选择...' : '重新定位文件'}
                                </button>
                            </div>
                            <p className="reader-error-hint">
                                如果文件被移动或重命名，可以重新选择本地 EPUB。
                            </p>
                        </>
                    ) : (
                        <>
                            <h2>无法打开书籍</h2>
                            <p>{error}</p>
                            <p className="reader-error-hint">
                                CReader 目前只支持可由 foliate-js 打开的标准 EPUB，不会执行 EPUB 内嵌脚本。
                            </p>
                        </>
                    )}
                </div>
            </div>
        );
    }

    const searchIndexState = currentBook.searchIndex?.state || 'missing';
    const searchIndexNeedsRebuild = searchIndexState === 'missing' || searchIndexState === 'failed' || searchIndexState === 'stale';
    const searchStatusText = searchError || searchIndexMessage(searchIndexState, currentBook.searchIndex?.error);

    return (
        <div className={`reader ${showToc ? 'toc-open' : ''}`}>
            {/* Loading indicator */}
            {isLoading && (
                <div className="reader-loading">
                    <span className="reader-loading-spinner" aria-hidden="true" />
                    <p>正在打开书籍...</p>
                </div>
            )}

            {/* TOC Panel */}
            {showToc && (
                <div className="reader-toc">
                    <div className="reader-toc-header">
                        <h3>目录</h3>
                        <button className="btn btn-ghost btn-icon" onClick={() => setShowToc(false)} aria-label="关闭目录">
                            <CloseIcon />
                        </button>
                    </div>
                    <ul className="reader-toc-list">
                        {toc.length === 0 ? (
                            <li className="reader-toc-empty">没有可用章节</li>
                        ) : (
                            toc.map(item => {
                                const isActive = item.href === currentTocHref ||
                                    (currentTocHref && item.href && currentTocHref.startsWith(item.href));
                                return (
                                <li key={item.id}>
                                    <button
                                        className={`reader-toc-item ${isActive ? 'current' : ''}`}
                                        onClick={() => handleTocClick(item.href)}
                                    >
                                        {item.label}
                                    </button>
                                    {item.subitems && item.subitems.length > 0 && (
                                        <ul className="reader-toc-sublist">
                                            {item.subitems.map(sub => {
                                                const subActive = sub.href === currentTocHref;
                                                return (
                                                <li key={sub.id}>
                                                    <button
                                                        className={`reader-toc-item reader-toc-subitem ${subActive ? 'current' : ''}`}
                                                        onClick={() => handleTocClick(sub.href)}
                                                    >
                                                        {sub.label}
                                                    </button>
                                                </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </li>
                                );
                            })
                        )}
                    </ul>
                </div>
            )}

            {/* TOC Toggle */}
            <button
                className="reader-chrome-control reader-toc-toggle btn btn-ghost btn-icon"
                onClick={() => setShowToc(!showToc)}
                aria-label="目录"
            >
                <EpubTocIcon size={18} />
            </button>

            {/* Navigation */}
            <button className="reader-chrome-control reader-nav reader-nav-prev" onClick={handlePrev} aria-label="上一页">
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
                        className="reader-chrome-control reader-accumulated-btn"
                        onClick={() => {
                            setAccumulatedPreviewOpen(open => !open);
                            setAIPanelOpen(true);
                        }}
                        aria-label={`${accumulatedTexts.length} 段选文，发送给 AI`}
                        aria-expanded={accumulatedPreviewOpen}
                    >
                        <LayersIcon />
                        <span>{accumulatedTexts.length} 段选文</span>
                    </button>
                    <div className={`reader-accumulated-preview ${accumulatedPreviewOpen ? 'preview-open' : ''}`}>
                        {accumulatedTexts.slice(-3).map((text, idx) => (
                            <div key={idx} className="reader-accumulated-preview-item">
                                {text.slice(0, 60)}{text.length > 60 ? '...' : ''}
                            </div>
                        ))}
                        {accumulatedTexts.length > 3 && (
                            <div className="reader-accumulated-preview-more">
                                另有 {accumulatedTexts.length - 3} 段
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Use Chapter Button - for translating entire chapters */}
            {currentChapterContent && currentChapterContent.length > 100 && (
                <div className="reader-chapter-action">
                    <button
                        className="reader-chrome-control reader-chapter-btn"
                        onClick={() => {
                            addToAccumulatedTexts(currentChapterContent);
                            setAIPanelOpen(true);
                        }}
                    >
                        <BookOpenIcon size={18} strokeWidth={2} />
                        <span>使用本章（约 {Math.round(currentChapterContent.length / 1000)}k 字）</span>
                    </button>
                    <button
                        className={`reader-chrome-control reader-chapter-btn reader-chapter-copy ${chapterCopied ? 'copied' : ''}`}
                        onClick={handleCopyChapter}
                    >
                        {chapterCopied ? <CheckIcon /> : <CopyIcon />}
                        <span>{chapterCopied ? '已复制' : '复制章节'}</span>
                    </button>
                </div>
            )}

            <button className="reader-chrome-control reader-nav reader-nav-next" onClick={handleNext} aria-label="下一页">
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
                                placeholder="在书中搜索"
                                className="reader-search-input"
                            />
                        </div>
                        <button className="btn btn-ghost btn-icon" onClick={() => { cancelSearch(); setSearchOpen(false); }}>
                            <CloseIcon />
                        </button>
                    </div>
                    <div className="reader-search-results">
                        {isSearching ? (
                            <div className="reader-search-status">正在搜索...</div>
                        ) : isRebuildingIndex ? (
                            <div className="reader-search-status">正在重建搜索索引...</div>
                        ) : searchStatusText && (Boolean(searchError) || searchIndexState !== 'ready') ? (
                            <div className="reader-search-status">
                                <span>{searchStatusText}</span>
                                {searchIndexNeedsRebuild && (
                                    <button className="btn btn-secondary reader-search-action" onClick={rebuildCurrentIndex}>
                                        {searchIndexState === 'failed' ? '重试索引' : '重建索引'}
                                    </button>
                                )}
                            </div>
                        ) : searchResults.length === 0 && searchQuery ? (
                            <div className="reader-search-status">没有找到结果</div>
                        ) : (
                            <>
                                {searchResults.length > 0 && (
                                    <div className="reader-search-meta">共 {searchResults.length} 个结果</div>
                                )}
                                {searchResults.map((result, index) => {
                                    const chapterLabel = resolveChapterLabel(result);
                                    return (
                                    <button
                                        key={index}
                                        className="reader-search-result"
                                        onClick={() => handleSearchResultClick(result)}
                                    >
                                        {chapterLabel && (
                                            <span className="reader-search-chapter">{chapterLabel}</span>
                                        )}
                                        <span className="reader-search-excerpt">{result.excerpt}</span>
                                    </button>
                                    );
                                })}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
