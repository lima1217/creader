import { useLibrary, useSettings, useUI, useBookProgress } from '../stores/AppContext';
import type { Theme } from '../types';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import {
    CoffeeIcon,
    MenuIcon,
    MinusIcon,
    MoonIcon,
    PlusIcon,
    SearchIcon,
    SunIcon,
    ToolbarAIIcon,
} from './icons/icons';
import './Toolbar.css';

export function Toolbar() {
    const { settings, setSettings } = useSettings();
    const { currentBook } = useLibrary();
    const { bookProgressById } = useBookProgress();
    const { isSidebarOpen, setSidebarOpen, isAIPanelOpen, setAIPanelOpen, isSearchOpen, setSearchOpen } = useUI();

    const displayProgress = currentBook ? (bookProgressById[currentBook.id]?.percentage ?? currentBook.progress.percentage ?? 0) : 0;

    const themes: Theme[] = ['light', 'dark', 'sepia'];
    const themeIcons = {
        light: <SunIcon />,
        dark: <MoonIcon />,
        sepia: <CoffeeIcon />,
    };

    const cycleTheme = () => {
        const currentIndex = themes.indexOf(settings.theme);
        const nextIndex = (currentIndex + 1) % themes.length;
        setSettings({ ...settings, theme: themes[nextIndex] });
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
        <header className="toolbar">
            <div className="toolbar-left">
                <button
                    className="btn btn-ghost btn-icon"
                    onClick={() => setSidebarOpen(!isSidebarOpen)}
                    title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
                >
                    <MenuIcon />
                </button>

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
                {/* Search can be added here */}
            </div>

            <div className="toolbar-right">
                {/* Font Size Controls */}
                <div className="toolbar-group toolbar-reading-group" aria-label="Reading controls">
                    <button
                        className="btn btn-ghost btn-icon"
                        onClick={() => adjustFontSize(-1)}
                        title="Decrease font size"
                        disabled={settings.fontSize <= 12}
                    >
                        <MinusIcon />
                    </button>
                    <span className="toolbar-font-size">{settings.fontSize}px</span>
                    <button
                        className="btn btn-ghost btn-icon"
                        onClick={() => adjustFontSize(1)}
                        title="Increase font size"
                        disabled={settings.fontSize >= 24}
                    >
                        <PlusIcon />
                    </button>
                </div>

                <div className="toolbar-group toolbar-view-group" aria-label="View controls">
                    {/* Theme Toggle */}
                    <button
                        className="btn btn-ghost btn-icon"
                        onClick={cycleTheme}
                        title={`Theme: ${settings.theme}`}
                    >
                        {themeIcons[settings.theme]}
                    </button>

                </div>

                <div className="toolbar-group toolbar-tool-group" aria-label="Content tools">
                    {/* Search */}
                    <button
                        className={`btn btn-ghost btn-icon ${isSearchOpen ? 'active' : ''}`}
                        onClick={() => setSearchOpen(!isSearchOpen)}
                        title="Search (Cmd/Ctrl+F)"
                    >
                        <SearchIcon />
                    </button>

                    {/* AI Chat Toggle */}
                    <button
                        className={`btn btn-ghost btn-icon ${isAIPanelOpen ? 'active' : ''}`}
                        onClick={() => setAIPanelOpen(!isAIPanelOpen)}
                        title="AI Assistant"
                    >
                        <ToolbarAIIcon />
                    </button>
                </div>
            </div>
        </header>
    );
}
