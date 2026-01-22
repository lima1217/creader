import { useApp } from '../stores/AppContext';
import type { Theme } from '../types';
import './Toolbar.css';

// Icons
const MenuIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
);

const SunIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
);

const MoonIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
);

const CoffeeIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
        <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
        <line x1="6" y1="1" x2="6" y2="4" />
        <line x1="10" y1="1" x2="10" y2="4" />
        <line x1="14" y1="1" x2="14" y2="4" />
    </svg>
);

const SearchIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
);

const CodeIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
    </svg>
);

// Minimalist AI Icon for toolbar - stroke-based to match other toolbar icons
const ToolbarAIIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {/* Central nucleus */}
        <circle cx="12" cy="12" r="2" />
        {/* Three orbital electrons */}
        <circle cx="12" cy="5" r="1.5" />
        <circle cx="6" cy="16" r="1.5" />
        <circle cx="18" cy="16" r="1.5" />
        {/* Connecting lines forming a triangular network */}
        <line x1="12" y1="7" x2="12" y2="10" />
        <line x1="10.5" y1="13.5" x2="7.5" y2="15" />
        <line x1="13.5" y1="13.5" x2="16.5" y2="15" />
    </svg>
);

const MinusIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

const PlusIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

export function Toolbar() {
    const {
        settings,
        setSettings,
        currentBook,
        library,
        isSidebarOpen,
        setSidebarOpen,
        isAIPanelOpen,
        setAIPanelOpen,
        isSearchOpen,
        setSearchOpen,
    } = useApp();

    // Get the actual book from library to get updated progress
    const bookFromLibrary = currentBook ? library.books.find(b => b.id === currentBook.id) : null;
    const displayProgress = bookFromLibrary?.progress.percentage ?? 0;

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

    const toggleEpubScripts = () => {
        if (settings.allowEpubScripts !== true) {
            const ok = window.confirm('Enable EPUB scripts? Only enable for trusted books.');
            if (!ok) return;
        }
        setSettings({ ...settings, allowEpubScripts: settings.allowEpubScripts !== true });
    };

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
                <div className="toolbar-group">
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

                {/* Theme Toggle */}
                <button
                    className="btn btn-ghost btn-icon"
                    onClick={cycleTheme}
                    title={`Theme: ${settings.theme}`}
                >
                    {themeIcons[settings.theme]}
                </button>

                <button
                    className={`btn btn-ghost btn-icon ${settings.allowEpubScripts ? 'active' : ''}`}
                    onClick={toggleEpubScripts}
                    title={settings.allowEpubScripts ? 'EPUB scripts: enabled (risky)' : 'EPUB scripts: disabled'}
                >
                    <CodeIcon />
                </button>

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
        </header>
    );
}
