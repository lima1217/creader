import { useEffect, useRef, useState } from 'react';
import { useLibrary, useSettings, useUI, useBookProgress } from '../stores/AppContext';
import type { Theme } from '../types';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import {
    MinusIcon,
    MoonIcon,
    PlusIcon,
    SearchIcon,
    SidebarPanelIcon,
    SunIcon,
    ToolbarAIIcon,
} from './icons/icons';
import './Toolbar.css';

export function Toolbar() {
    const { settings, setSettings } = useSettings();
    const { currentBook } = useLibrary();
    const { bookProgressById } = useBookProgress();
    const { isSidebarOpen, setSidebarOpen, isAIPanelOpen, setAIPanelOpen, isSearchOpen, setSearchOpen } = useUI();
    const [isThemeMenuOpen, setThemeMenuOpen] = useState(false);
    const themeMenuRef = useRef<HTMLDivElement>(null);

    const displayProgress = currentBook ? (bookProgressById[currentBook.id]?.percentage ?? currentBook.progress.percentage ?? 0) : 0;

    const themes: Theme[] = ['light', 'dark'];
    const themeIcons = {
        light: <SunIcon />,
        dark: <MoonIcon />,
    };

    const themeLabels: Record<Theme, string> = {
        light: '亮色',
        dark: '暗色',
    };

    const selectTheme = (theme: Theme) => {
        setSettings({ ...settings, theme });
        setThemeMenuOpen(false);
    };

    useEffect(() => {
        if (!isThemeMenuOpen) return;

        const handlePointerDown = (event: PointerEvent) => {
            if (themeMenuRef.current && !themeMenuRef.current.contains(event.target as Node)) {
                setThemeMenuOpen(false);
            }
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setThemeMenuOpen(false);
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isThemeMenuOpen]);

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
        <header className="toolbar">
            <div className="toolbar-left">
                {!isSidebarOpen && (
                    <button
                        className="btn btn-ghost btn-icon toolbar-sidebar-restore"
                        onClick={() => setSidebarOpen(true)}
                        title="显示侧栏"
                        aria-label="显示侧栏"
                    >
                        <SidebarPanelIcon size={23} strokeWidth={1.7} />
                    </button>
                )}
                {currentBook && (
                    <div className="toolbar-book-info">
                        <span className="toolbar-book-title">{currentBook.title}</span>
                        <span className="toolbar-book-progress">
                            {Math.round(displayProgress)}%
                        </span>
                    </div>
                )}
            </div>

            <div className="toolbar-center">
                <div className="toolbar-group toolbar-reading-group" aria-label="阅读控制">
                    <button
                        className="btn btn-ghost btn-icon"
                        onClick={() => adjustFontSize(-1)}
                        title="减小字号"
                        disabled={settings.fontSize <= 12}
                    >
                        <MinusIcon />
                    </button>
                    <span className="toolbar-font-size">{settings.fontSize}px</span>
                    <button
                        className="btn btn-ghost btn-icon"
                        onClick={() => adjustFontSize(1)}
                        title="增大字号"
                        disabled={settings.fontSize >= 24}
                    >
                        <PlusIcon />
                    </button>
                    <span className="toolbar-group-divider" aria-hidden="true" />
                    <div className="toolbar-theme-menu" ref={themeMenuRef}>
                        <button
                            className={`btn btn-secondary toolbar-action toolbar-theme-button ${isThemeMenuOpen ? 'active' : ''}`}
                            onClick={() => setThemeMenuOpen(open => !open)}
                            title={`主题：${themeLabels[settings.theme]}`}
                            aria-label={`主题：${themeLabels[settings.theme]}`}
                            aria-haspopup="menu"
                            aria-expanded={isThemeMenuOpen}
                        >
                            {themeIcons[settings.theme]}
                        </button>
                        {isThemeMenuOpen && (
                            <div className="toolbar-theme-dropdown" role="menu">
                                {themes.map(theme => (
                                    <button
                                        key={theme}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={settings.theme === theme}
                                        className={`toolbar-theme-option ${settings.theme === theme ? 'selected' : ''}`}
                                        onClick={() => selectTheme(theme)}
                                    >
                                        {themeIcons[theme]}
                                        <span>{themeLabels[theme]}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="toolbar-right">
                <div className="toolbar-action-group" aria-label="内容工具">
                    <button
                        className={`btn btn-secondary toolbar-action ${isSearchOpen ? 'active' : ''}`}
                        onClick={() => setSearchOpen(!isSearchOpen)}
                        title="搜索（Cmd/Ctrl+F）"
                        aria-label="搜索"
                    >
                        <SearchIcon />
                    </button>

                    <button
                        className="btn btn-secondary toolbar-action toolbar-ai-action"
                        onClick={() => setAIPanelOpen(!isAIPanelOpen)}
                        title="AI 助手"
                        aria-label="AI 助手"
                    >
                        <ToolbarAIIcon />
                    </button>
                </div>
            </div>
        </header>
    );
}
