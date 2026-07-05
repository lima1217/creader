import { useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useLibraryStore } from '../stores/libraryStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { NavItem } from '../types';
import type { ReaderRendition } from '../services/reader/epubAdapter';
import { tryCopyBookToLibrary } from '../services/BookImportService';
import { rebuildSearchIndexQuietly, toSearchIndexSummary } from '../services/reader/searchIndex';
import { createLogger } from '../utils/logger';
import { applyEpubTheme } from './reader/epubTheme';
import { SelectionToolbar } from './reader/SelectionToolbar';
import { useEpubBookLifecycle } from './reader/useEpubBookLifecycle';
import { useReadingChromeSession } from './reader/useReadingChromeSession';
import './EPUBReader.css';
import './SelectionToolbar.css';
import { AILogoIcon, CheckIcon, CopyIcon, PlusIcon as SelectionPlusIcon } from './ai/icons';
import { BookOpenIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, FileIcon, LayersIcon, SearchIcon } from './icons/icons';

const logger = createLogger('EPUBReader');

export function EPUBReader() {
    const currentBook = useLibraryStore((s) => s.currentBook);
    const updateBookFilePath = useLibraryStore((s) => s.updateBookFilePath);
    const updateBookSearchIndex = useLibraryStore((s) => s.updateBookSearchIndex);
    const settings = useSettingsStore((s) => s.settings);
    const containerRef = useRef<HTMLDivElement>(null);
    const renditionRef = useRef<ReaderRendition | null>(null);
    const [renditionKey, setRenditionKey] = useState(0);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isFileNotFound, setIsFileNotFound] = useState(false);
    const [isRelocating, setIsRelocating] = useState(false);

    const chrome = useReadingChromeSession({
        currentBook,
        renditionRef,
        renditionKey,
    });

    useEpubBookLifecycle({
        currentBook,
        containerRef,
        settings,
        renditionRef,
        setToc: chrome.setToc,
        setIsLoading,
        setError,
        setIsFileNotFound,
        onRenditionCreated: () => setRenditionKey(k => k + 1),
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

    const renderTocItems = (items: NavItem[], depth = 0) => items.map(item => {
        const isActive = chrome.isTocItemCurrent(item.href);
        const isSubitem = depth > 0;
        return (
            <li key={item.id}>
                <button
                    className={`reader-toc-item ${isSubitem ? 'reader-toc-subitem' : ''} ${isActive ? 'current' : ''}`}
                    onClick={() => chrome.handleTocClick(item.href)}
                >
                    {item.label}
                </button>
                {item.subitems && item.subitems.length > 0 && (
                    <ul className="reader-toc-sublist">
                        {renderTocItems(item.subitems, depth + 1)}
                    </ul>
                )}
            </li>
        );
    });

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

    return (
        <div className={`reader ${chrome.showToc ? 'toc-open' : ''}`}>
            {/* Loading indicator */}
            {isLoading && (
                <div className="reader-loading">
                    <span className="reader-loading-spinner" aria-hidden="true" />
                    <p>正在打开书籍...</p>
                </div>
            )}

            {/* TOC Panel */}
            {chrome.showToc && (
                <div className="reader-toc">
                    <div className="reader-toc-header">
                        <h3>目录</h3>
                        <button className="btn btn-ghost btn-icon" onClick={() => chrome.setShowToc(false)} aria-label="关闭目录">
                            <CloseIcon />
                        </button>
                    </div>
                    <ul className="reader-toc-list">
                        {chrome.toc.length === 0 ? (
                            <li className="reader-toc-empty">没有可用章节</li>
                        ) : (
                            renderTocItems(chrome.toc)
                        )}
                    </ul>
                </div>
            )}

            {/* Navigation */}
            <button className="reader-chrome-control reader-nav reader-nav-prev" onClick={chrome.handlePrev} aria-label="上一页">
                <ChevronLeftIcon />
            </button>

            {/* Book Content */}
            <div ref={containerRef} className="reader-content" />

            <SelectionToolbar
                visible={chrome.selectionToolbar.visible}
                selectedText={chrome.selectionToolbar.selectedText}
                position={chrome.selectionToolbar.position}
                accumulatedCount={chrome.selectionToolbar.accumulatedCount}
                addIcon={<SelectionPlusIcon />}
                askIcon={<AILogoIcon size={14} />}
                closeIcon={<CloseIcon />}
                onAdd={chrome.selectionToolbar.onAdd}
                onAsk={chrome.selectionToolbar.onAsk}
                onClose={chrome.selectionToolbar.onClose}
                showHint={chrome.selectionToolbar.showHint}
            />

            {/* Accumulated Texts Indicator */}
            {chrome.accumulatedTexts.length > 0 && (
                <div className="reader-accumulated-indicator">
                    <button
                        className="reader-chrome-control reader-accumulated-btn"
                        onClick={chrome.onAccumulatedTextsClick}
                        aria-label={`${chrome.accumulatedTexts.length} 段选文，发送给 AI`}
                        aria-expanded={chrome.accumulatedPreviewOpen}
                    >
                        <LayersIcon />
                        <span>{chrome.accumulatedTexts.length} 段选文</span>
                    </button>
                    <div className={`reader-accumulated-preview ${chrome.accumulatedPreviewOpen ? 'preview-open' : ''}`}>
                        {chrome.accumulatedTexts.slice(-3).map((text, idx) => (
                            <div key={idx} className="reader-accumulated-preview-item">
                                {text.slice(0, 60)}{text.length > 60 ? '...' : ''}
                            </div>
                        ))}
                        {chrome.accumulatedTexts.length > 3 && (
                            <div className="reader-accumulated-preview-more">
                                另有 {chrome.accumulatedTexts.length - 3} 段
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Use Chapter Button - for translating entire chapters */}
            {chrome.currentChapterContent && chrome.currentChapterContent.length > 100 && (
                <div className="reader-chapter-action">
                    <button
                        className="reader-chrome-control reader-chapter-btn"
                        onClick={chrome.onUseChapter}
                    >
                        <BookOpenIcon size={18} strokeWidth={2} />
                        <span>使用本章（约 {Math.round(chrome.currentChapterContent.length / 1000)}k 字）</span>
                    </button>
                    <button
                        className={`reader-chrome-control reader-chapter-btn reader-chapter-copy ${chrome.chapterCopied ? 'copied' : ''}`}
                        onClick={chrome.onCopyChapter}
                    >
                        {chrome.chapterCopied ? <CheckIcon /> : <CopyIcon />}
                        <span>{chrome.chapterCopied ? '已复制' : '复制章节'}</span>
                    </button>
                </div>
            )}

            <button className="reader-chrome-control reader-nav reader-nav-next" onClick={chrome.handleNext} aria-label="下一页">
                <ChevronRightIcon />
            </button>

            {/* Search Panel */}
            {chrome.search.isOpen && (
                <div className="reader-search">
                    <div className="reader-search-header">
                        <div className="reader-search-input-wrapper">
                            <SearchIcon />
                            <input
                                ref={chrome.search.inputRef}
                                type="text"
                                value={chrome.search.searchQuery}
                                onChange={(e) => chrome.search.setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && chrome.search.handleSearch()}
                                placeholder="在书中搜索"
                                className="reader-search-input"
                            />
                        </div>
                        <button className="btn btn-ghost btn-icon" onClick={chrome.search.close}>
                            <CloseIcon />
                        </button>
                    </div>
                    <div className="reader-search-results">
                        {chrome.search.isSearching ? (
                            <div className="reader-search-status">正在搜索...</div>
                        ) : chrome.search.isRebuildingIndex ? (
                            <div className="reader-search-status">正在重建搜索索引...</div>
                        ) : chrome.search.statusText && (Boolean(chrome.search.searchError) || chrome.search.indexState !== 'ready') ? (
                            <div className="reader-search-status">
                                <span>{chrome.search.statusText}</span>
                                {chrome.search.indexNeedsRebuild && (
                                    <button className="btn btn-secondary reader-search-action" onClick={chrome.search.rebuildCurrentIndex}>
                                        {chrome.search.indexState === 'failed' ? '重试索引' : '重建索引'}
                                    </button>
                                )}
                            </div>
                        ) : chrome.search.searchResults.length === 0 && chrome.search.searchQuery ? (
                            <div className="reader-search-status">没有找到结果</div>
                        ) : (
                            <>
                                {chrome.search.searchResults.length > 0 && (
                                    <div className="reader-search-meta">共 {chrome.search.searchResults.length} 个结果</div>
                                )}
                                {chrome.search.searchResults.map((result, index) => {
                                    const chapterLabel = chrome.search.resolveChapterLabel(result);
                                    return (
                                    <button
                                        key={index}
                                        className="reader-search-result"
                                        onClick={() => chrome.search.handleSearchResultClick(result)}
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
