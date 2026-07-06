import { useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useLibraryStore } from '../stores/libraryStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { NavItem } from '../types';
import type { ReaderRendition } from '../services/reader/epubAdapter';
import { tryCopyBookToLibrary } from '../services/BookImportService';
import { createLogger } from '../utils/logger';
import { handleWindowDragMouseDown } from '../utils/windowDrag';
import { applyEpubTheme, buildFontStack } from './reader/epubTheme';
import { SelectionToolbar } from './reader/SelectionToolbar';
import { useEpubBookLifecycle } from './reader/useEpubBookLifecycle';
import { useReadingChromeSession } from './reader/useReadingChromeSession';
import './EPUBReader.css';
import './SelectionToolbar.css';
import { AILogoIcon, PlusIcon as SelectionPlusIcon } from './ai/icons';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, FileIcon, LayersIcon } from './icons/icons';

const logger = createLogger('EPUBReader');

export function EPUBReader() {
    const currentBook = useLibraryStore((s) => s.currentBook);
    const updateBookFilePath = useLibraryStore((s) => s.updateBookFilePath);
    const settings = useSettingsStore((s) => s.settings);
    const containerRef = useRef<HTMLDivElement>(null);
    const renditionRef = useRef<ReaderRendition | null>(null);
    const [activeRendition, setActiveRendition] = useState<ReaderRendition | null>(null);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isFileNotFound, setIsFileNotFound] = useState(false);
    const [isEngineLoadError, setIsEngineLoadError] = useState(false);
    const [isRelocating, setIsRelocating] = useState(false);

    const chrome = useReadingChromeSession({
        currentBook,
        renditionRef,
        rendition: activeRendition,
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
        setIsEngineLoadError,
        onRenditionCreated: setActiveRendition,
    });

    // Update styles when settings change (including theme)
    useEffect(() => {
        if (renditionRef.current) {
            applyEpubTheme(renditionRef.current, {
                theme: settings.theme,
                fontStack: buildFontStack(settings.fontFamily),
                fontSize: settings.fontSize,
            });
        }
    }, [settings.fontSize, settings.fontFamily, settings.theme]);

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
                // Clear error state to trigger reload
                setError(null);
                setIsFileNotFound(false);
                setIsEngineLoadError(false);
            }
        } catch (err) {
            logger.error('Failed to relocate file:', err);
        } finally {
            setIsRelocating(false);
        }
    };

    if (!currentBook) {
        return (
            <div className="reader-empty" onMouseDown={handleWindowDragMouseDown}>
                <div className="reader-empty-content">
                    <h2>选择一本书开始阅读</h2>
                    <p>从左侧书库打开 EPUB，或导入一本新书。</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="reader-empty" onMouseDown={handleWindowDragMouseDown}>
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
                    ) : isEngineLoadError ? (
                        <>
                            <h2>无法加载阅读引擎</h2>
                            <p>{error}</p>
                            <p className="reader-error-hint">
                                这通常是应用打包不完整导致的，与 EPUB 文件本身无关。
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
        <div className={`reader ${chrome.showToc ? 'toc-open' : ''}`} onMouseDown={handleWindowDragMouseDown}>
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

            <button className="reader-chrome-control reader-nav reader-nav-next" onClick={chrome.handleNext} aria-label="下一页">
                <ChevronRightIcon />
            </button>
        </div>
    );
}
