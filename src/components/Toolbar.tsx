import { useLibraryStore } from '../stores/libraryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { useProgressStore } from '../stores/progressStore';
import type { Theme } from '../types';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import {
    MinusIcon,
    MoonIcon,
    PlusIcon,
    SearchIcon,
    SunIcon,
    ToolbarAIIcon,
    EpubTocIcon,
} from './icons/icons';
import './Toolbar.css';

export function Toolbar() {
    const settings = useSettingsStore((s) => s.settings);
    const setSettings = useSettingsStore((s) => s.setSettings);
    const currentBook = useLibraryStore((s) => s.currentBook);
    const bookProgressById = useProgressStore((s) => s.bookProgressById);
    const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
    const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
    const isAIPanelOpen = useUIStore((s) => s.isAIPanelOpen);
    const setAIPanelOpen = useUIStore((s) => s.setAIPanelOpen);
    const isSearchOpen = useUIStore((s) => s.isSearchOpen);
    const setSearchOpen = useUIStore((s) => s.setSearchOpen);
    const isTocOpen = useUIStore((s) => s.isTocOpen);
    const setTocOpen = useUIStore((s) => s.setTocOpen);

    const displayProgress = currentBook ? (bookProgressById[currentBook.id]?.percentage ?? currentBook.progress.percentage ?? 0) : 0;

    const themes: Theme[] = ['light', 'dark'];
    const themeIcons: Record<Theme, React.ReactNode> = {
        light: <SunIcon size={18} strokeWidth={1.9} />,
        dark: <MoonIcon size={18} strokeWidth={1.9} />,
    };

    const themeLabels: Record<Theme, string> = {
        light: '亮色',
        dark: '暗色',
    };

    const themeDescriptions: Record<Theme, string> = {
        light: '纸面阅读',
        dark: '夜间阅读',
    };

    const selectTheme = (theme: Theme) => {
        setSettings({ ...settings, theme });
    };

    const adjustFontSize = (delta: number) => {
        const newSize = Math.min(24, Math.max(12, settings.fontSize + delta));
        setSettings({ ...settings, fontSize: newSize });
    };

    useKeyboardShortcuts({
        isSidebarOpen,
        setSidebarOpen,
        isSearchOpen,
        setSearchOpen,
        isAIPanelOpen,
        setAIPanelOpen,
    });

    return (
        <header className="toolbar" data-tauri-drag-region>
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
                            <span className="toolbar-book-title">{currentBook.title}</span>
                            <span className="toolbar-book-progress">
                                {Math.round(displayProgress)}%
                            </span>
                        </div>
                    </div>
                )}
            </div>

            <div className="toolbar-center">
                <div className="toolbar-group toolbar-reading-group" aria-label="阅读控制">
                    <button
                        className="btn btn-ghost btn-icon"
                        onClick={() => adjustFontSize(-1)}
                        aria-label="减小字号"
                        disabled={settings.fontSize <= 12}
                    >
                        <MinusIcon />
                    </button>
                    <span className="toolbar-font-size">{settings.fontSize}px</span>
                    <button
                        className="btn btn-ghost btn-icon"
                        onClick={() => adjustFontSize(1)}
                        aria-label="增大字号"
                        disabled={settings.fontSize >= 24}
                    >
                        <PlusIcon />
                    </button>
                    <span className="toolbar-group-divider" aria-hidden="true" />
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
                        menuWidth={184}
                        aria-label="主题"
                        items={[
                            {
                                type: 'section',
                                title: '阅读主题',
                                items: themes.map(theme => ({
                                    label: `${themeLabels[theme]} · ${themeDescriptions[theme]}`,
                                    icon: themeIcons[theme],
                                    onClick: () => selectTheme(theme),
                                })),
                            },
                        ]}
                    />
                </div>
            </div>

            <div className="toolbar-right">
                <div className="toolbar-action-group" aria-label="内容工具">
                    <button
                        className={`btn btn-secondary toolbar-action ${isSearchOpen ? 'active' : ''}`}
                        onClick={() => setSearchOpen(!isSearchOpen)}
                        aria-label="搜索"
                    >
                        <SearchIcon />
                    </button>

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
