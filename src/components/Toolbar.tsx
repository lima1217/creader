import { useEffect, useState } from 'react';
import { useLibraryStore } from '../stores/libraryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { useAIStore } from '../stores/aiStore';
import { useSelectionStore } from '../stores/selectionStore';
import type { Theme } from '../types';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { DropdownMenu, DropdownMenuItem } from '@astryxdesign/core/DropdownMenu';
import { Selector } from '@astryxdesign/core/Selector';
import {
    ChapterIcon,
    CheckIcon,
    CopyIcon,
    MoreHorizontalIcon,
    MoonIcon,
    SunIcon,
    ToolbarAIIcon,
    EpubTocIcon,
} from './icons/icons';
import { TextSizeControl } from './TextSizeControl';
import { FONT_CATALOG, normalizeFontFamilyKey } from './reader/fontCatalog';
import { createLogger } from '../utils/logger';
import { handleWindowDragMouseDown } from '../utils/windowDrag';
import './Toolbar.css';

const logger = createLogger('Toolbar');

export function Toolbar() {
    const settings = useSettingsStore((s) => s.settings);
    const setSettings = useSettingsStore((s) => s.setSettings);
    const currentBook = useLibraryStore((s) => s.currentBook);
    const currentChapterContent = useAIStore((s) => s.currentChapterContent);
    const currentChapterTitle = useAIStore((s) => s.currentChapterTitle);
    const currentChapterRemainingPercent = useAIStore((s) => s.currentChapterRemainingPercent);
    const addToAccumulatedTexts = useSelectionStore((s) => s.addToAccumulatedTexts);
    const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
    const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
    const isAIPanelOpen = useUIStore((s) => s.isAIPanelOpen);
    const setAIPanelOpen = useUIStore((s) => s.setAIPanelOpen);
    const isTocOpen = useUIStore((s) => s.isTocOpen);
    const setTocOpen = useUIStore((s) => s.setTocOpen);
    const [chapterCopied, setChapterCopied] = useState(false);

    const canUseChapter = Boolean(currentChapterContent && currentChapterContent.length > 100);
    const useChapterLabel = canUseChapter
        ? `使用本章（约 ${Math.round(currentChapterContent!.length / 1000)}k 字）`
        : '使用本章';

    const themes: Theme[] = ['light', 'dark'];
    const fontFamilyKey = normalizeFontFamilyKey(settings.fontFamily);
    const themeIcons: Record<Theme, React.ReactNode> = {
        light: <SunIcon size={18} strokeWidth={1.9} />,
        dark: <MoonIcon size={18} strokeWidth={1.9} />,
    };

    const themeLabels: Record<Theme, string> = {
        light: '亮色',
        dark: '暗色',
    };

    const selectTheme = (theme: Theme) => {
        setSettings({ ...settings, theme });
    };

    const handleUseChapter = () => {
        if (!canUseChapter || !currentChapterContent) return;
        addToAccumulatedTexts(currentChapterContent);
        setAIPanelOpen(true);
    };

    const handleCopyChapter = async () => {
        if (!canUseChapter || !currentChapterContent) return;

        try {
            await navigator.clipboard.writeText(currentChapterContent);
            setChapterCopied(true);
            window.setTimeout(() => setChapterCopied(false), 2000);
        } catch {
            logger.warn('Failed to copy chapter content');
        }
    };

    useEffect(() => {
        setChapterCopied(false);
    }, [currentChapterContent]);

    useKeyboardShortcuts({
        isSidebarOpen,
        setSidebarOpen,
        isAIPanelOpen,
        setAIPanelOpen,
    });

    return (
        <header className="toolbar" onMouseDown={handleWindowDragMouseDown}>
            <div className="toolbar-left">
                {currentBook && (
                    <div className="toolbar-book-cluster">
                        <button
                            className={`btn btn-ghost btn-icon toolbar-action toolbar-toc-action ${isTocOpen ? 'active' : ''}`}
                            onClick={() => setTocOpen(!isTocOpen)}
                            aria-label={isTocOpen ? '隐藏目录' : '查看章节'}
                            aria-pressed={isTocOpen}
                        >
                            <EpubTocIcon size={18} />
                        </button>
                        <div className="toolbar-book-info">
                            <span className="toolbar-book-title">{currentChapterTitle ?? '…'}</span>
                            {currentChapterRemainingPercent !== null && (
                                <span
                                    className="toolbar-book-progress"
                                    title="本章剩余"
                                >
                                    {currentChapterRemainingPercent}%
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <div className="toolbar-right">
                <div className="toolbar-action-group" aria-label="内容工具">
                    <DropdownMenu
                        button={{
                            label: '更多阅读工具',
                            isIconOnly: true,
                            icon: <MoreHorizontalIcon size={18} strokeWidth={1.9} />,
                            variant: 'secondary',
                            size: 'md',
                            className: 'toolbar-action toolbar-more-button',
                        }}
                        hasChevron={false}
                        placement="below"
                        menuWidth={220}
                        aria-label="更多阅读工具"
                    >
                        <div role="group" aria-label="字号" className="toolbar-more-section">
                            <div className="toolbar-more-section-title" aria-hidden="true">字号</div>
                            <div className="toolbar-more-font-size">
                                <TextSizeControl
                                    value={settings.fontSize}
                                    min={12}
                                    max={24}
                                    onChange={fontSize => setSettings({ ...settings, fontSize })}
                                    inputLabel="字号"
                                    decrementAriaLabel="减小字号"
                                    incrementAriaLabel="增大字号"
                                />
                            </div>
                        </div>
                        <div role="group" aria-label="字体" className="toolbar-more-section">
                            <div className="toolbar-more-section-title" aria-hidden="true">字体</div>
                            <div className="toolbar-more-font-family">
                                <Selector
                                    label="字体"
                                    isLabelHidden
                                    size="sm"
                                    value={fontFamilyKey}
                                    options={FONT_CATALOG.map(({ key, label }) => ({ value: key, label }))}
                                    onChange={(key) => setSettings({ ...settings, fontFamily: key })}
                                />
                            </div>
                        </div>
                        <div role="group" aria-label="章节" className="toolbar-more-section">
                            <div className="toolbar-more-section-title" aria-hidden="true">章节</div>
                            <DropdownMenuItem
                                label={chapterCopied ? '已复制章节' : '复制章节'}
                                icon={chapterCopied ? <CheckIcon /> : <CopyIcon />}
                                isDisabled={!canUseChapter}
                                onClick={handleCopyChapter}
                            />
                        </div>
                    </DropdownMenu>

                    <button
                        type="button"
                        className="btn btn-secondary toolbar-action toolbar-chapter-action"
                        onClick={handleUseChapter}
                        disabled={!canUseChapter}
                        aria-label={useChapterLabel}
                        title={useChapterLabel}
                    >
                        <ChapterIcon size={18} strokeWidth={1.9} />
                    </button>

                    <DropdownMenu
                        button={{
                            label: `主题：${themeLabels[settings.theme]}`,
                            isIconOnly: true,
                            icon: themeIcons[settings.theme],
                            variant: 'secondary',
                            size: 'md',
                            className: 'toolbar-action toolbar-theme-button',
                        }}
                        hasChevron={false}
                        placement="below"
                        menuWidth={128}
                        aria-label="主题"
                        items={[
                            {
                                type: 'section',
                                title: '阅读主题',
                                items: themes.map(theme => ({
                                    label: themeLabels[theme],
                                    icon: themeIcons[theme],
                                    onClick: () => selectTheme(theme),
                                })),
                            },
                        ]}
                    />

                    <button
                        className="btn btn-secondary toolbar-action toolbar-ai-action"
                        onClick={() => setAIPanelOpen(!isAIPanelOpen)}
                        aria-label="AI 助手"
                    >
                        <ToolbarAIIcon />
                    </button>
                </div>
            </div>
        </header>
    );
}
