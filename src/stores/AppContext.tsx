import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import type { Settings, Book, Library, ChatMessage, BookCategory } from '../types';
import { dataUrlToBlob, deleteCover, revokeCoverUrl, saveCover } from '../services/CoverStore';
import { loadStored, saveStored, STORAGE_KEYS } from '../services/LocalStore';
import { MAX_CHAT_MESSAGES_STORED } from '../constants';

// Default settings
const defaultSettings: Settings = {
    theme: 'light',
    fontSize: 16,
    fontFamily: 'Georgia',
    lineHeight: 1.6,
    allowEpubScripts: false,
};

// App state context
interface AppState {
    // Settings
    settings: Settings;
    setSettings: (settings: Settings) => void;

    // Library
    library: Library;
    setLibrary: (library: Library) => void;
    addBook: (book: Book) => void;
    removeBook: (id: string) => void;
    updateBook: (id: string, updates: Partial<Pick<Book, 'title' | 'author' | 'categoryId'>>) => void;
    updateBookFilePath: (id: string, newFilePath: string) => void;
    updateBookProgress: (id: string, cfi: string, percentage: number) => void;

    // Categories
    addCategory: (name: string, color: string) => BookCategory;
    removeCategory: (id: string) => void;
    updateCategory: (id: string, updates: Partial<Pick<BookCategory, 'name' | 'color'>>) => void;
    setBookCategory: (bookId: string, categoryId: string | undefined) => void;

    // Current book
    currentBook: Book | null;
    setCurrentBook: (book: Book | null) => void;

    // Current chapter content (for AI context)
    currentChapterContent: string;
    setCurrentChapterContent: (content: string) => void;

    // AI Chat
    chatMessages: ChatMessage[];
    addChatMessage: (message: ChatMessage) => void;
    clearChat: () => void;

    // UI State
    isSidebarOpen: boolean;
    setSidebarOpen: (open: boolean) => void;
    isAIPanelOpen: boolean;
    setAIPanelOpen: (open: boolean) => void;
    isSearchOpen: boolean;
    setSearchOpen: (open: boolean) => void;

    // Selected text for AI context
    selectedText: string;
    setSelectedText: (text: string) => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
    // Settings
    const [settings, setSettingsState] = useState<Settings>(() => ({
        ...defaultSettings,
        ...loadStored(STORAGE_KEYS.settings, defaultSettings),
    }));

    // Library
    const [library, setLibraryState] = useState<Library>(() =>
        loadStored(STORAGE_KEYS.library, { books: [], categories: [], lastUpdated: Date.now() })
    );

    // Current book
    const [currentBook, setCurrentBook] = useState<Book | null>(null);

    // Current chapter content for AI
    const [currentChapterContent, setCurrentChapterContent] = useState<string>('');

    // Chat - load from storage
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() =>
        loadStored(STORAGE_KEYS.chat, [])
    );

    // Selected text
    const [selectedText, setSelectedText] = useState<string>('');

    // UI State
    const [isSidebarOpen, setSidebarOpen] = useState(true);
    const [isAIPanelOpen, setAIPanelOpen] = useState(false);
    const [isSearchOpen, setSearchOpen] = useState(false);

    // Apply theme
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', settings.theme);
    }, [settings.theme]);

    // Save settings
    useEffect(() => {
        saveStored(STORAGE_KEYS.settings, settings);
    }, [settings]);

    // Save library
    useEffect(() => {
        saveStored(STORAGE_KEYS.library, library);
    }, [library]);

    useEffect(() => {
        let cancelled = false;

        const migrateCovers = async () => {
            const toMigrate = library.books.filter(b => !!b.cover && b.cover.startsWith('data:') && !b.coverKey);
            if (toMigrate.length === 0) return;

            const migratedIds = new Set<string>();
            for (const book of toMigrate) {
                try {
                    const blob = await dataUrlToBlob(book.cover as string);
                    await saveCover(book.id, blob);
                    migratedIds.add(book.id);
                } catch (e) {
                    console.error('Failed to migrate cover:', e);
                }
            }

            if (cancelled) return;
            if (migratedIds.size > 0) {
                setLibraryState(prev => ({
                    ...prev,
                    books: prev.books.map(b => migratedIds.has(b.id) ? { ...b, cover: undefined, coverKey: b.id } : b),
                    lastUpdated: Date.now(),
                }));
            }
        };

        migrateCovers();
        return () => {
            cancelled = true;
        };
    }, [library.books]);

    // Save chat messages
    useEffect(() => {
        // Only keep last N messages to avoid storage overflow
        const messagesToSave = chatMessages.slice(-MAX_CHAT_MESSAGES_STORED);
        saveStored(STORAGE_KEYS.chat, messagesToSave);
    }, [chatMessages]);

    // Setters
    const setSettings = (newSettings: Settings) => {
        setSettingsState(newSettings);
    };

    const setLibrary = (newLibrary: Library) => {
        setLibraryState(newLibrary);
    };

    const addBook = (book: Book) => {
        setLibraryState(prev => ({
            ...prev,
            books: [...prev.books, book],
            lastUpdated: Date.now(),
        }));
    };

    const removeBook = (id: string) => {
        // Find the book to get its file path
        const book = library.books.find(b => b.id === id);

        void deleteCover(id);
        revokeCoverUrl(id);

        // Delete the book file if it's in the app's books directory
        if (book?.filePath) {
            import('@tauri-apps/api/core').then(({ invoke }) => {
                invoke('delete_book_file', { filePath: book.filePath })
                    .catch(err => console.warn('Failed to delete book file:', err));
            }).catch(() => {
                // Not running in Tauri environment
            });
        }

        setLibraryState(prev => ({
            ...prev,
            books: prev.books.filter(b => b.id !== id),
            lastUpdated: Date.now(),
        }));
    };

    const updateBook = (id: string, updates: Partial<Pick<Book, 'title' | 'author' | 'categoryId'>>) => {
        setLibraryState(prev => ({
            ...prev,
            books: prev.books.map(b =>
                b.id === id ? { ...b, ...updates } : b
            ),
            lastUpdated: Date.now(),
        }));
        // Also update currentBook if it's the one being edited
        if (currentBook?.id === id) {
            setCurrentBook({ ...currentBook, ...updates });
        }
    };

    const updateBookFilePath = (id: string, newFilePath: string) => {
        setLibraryState(prev => ({
            ...prev,
            books: prev.books.map(b =>
                b.id === id ? { ...b, filePath: newFilePath } : b
            ),
            lastUpdated: Date.now(),
        }));
        // Also update currentBook if it's the one being updated
        if (currentBook?.id === id) {
            setCurrentBook({ ...currentBook, filePath: newFilePath });
        }
    };

    const updateBookProgress = (id: string, cfi: string, percentage: number) => {
        setLibraryState(prev => ({
            ...prev,
            books: prev.books.map(b =>
                b.id === id
                    ? { ...b, progress: { ...b.progress, currentCfi: cfi, percentage }, lastReadAt: Date.now() }
                    : b
            ),
            lastUpdated: Date.now(),
        }));
    };

    // Category management
    const addCategory = (name: string, color: string): BookCategory => {
        const newCategory: BookCategory = {
            id: Date.now().toString(),
            name,
            color,
            createdAt: Date.now(),
        };
        setLibraryState(prev => ({
            ...prev,
            categories: [...(prev.categories || []), newCategory],
            lastUpdated: Date.now(),
        }));
        return newCategory;
    };

    const removeCategory = (id: string) => {
        setLibraryState(prev => ({
            ...prev,
            categories: (prev.categories || []).filter(c => c.id !== id),
            // Also remove category assignment from books
            books: prev.books.map(b =>
                b.categoryId === id ? { ...b, categoryId: undefined } : b
            ),
            lastUpdated: Date.now(),
        }));
    };

    const updateCategory = (id: string, updates: Partial<Pick<BookCategory, 'name' | 'color'>>) => {
        setLibraryState(prev => ({
            ...prev,
            categories: (prev.categories || []).map(c =>
                c.id === id ? { ...c, ...updates } : c
            ),
            lastUpdated: Date.now(),
        }));
    };

    const setBookCategory = (bookId: string, categoryId: string | undefined) => {
        setLibraryState(prev => ({
            ...prev,
            books: prev.books.map(b =>
                b.id === bookId ? { ...b, categoryId } : b
            ),
            lastUpdated: Date.now(),
        }));
    };

    const addChatMessage = (message: ChatMessage) => {
        setChatMessages(prev => [...prev, message]);
    };

    const clearChat = () => {
        setChatMessages([]);
    };

    const value: AppState = {
        settings,
        setSettings,
        library,
        setLibrary,
        addBook,
        removeBook,
        updateBook,
        updateBookFilePath,
        updateBookProgress,
        addCategory,
        removeCategory,
        updateCategory,
        setBookCategory,
        currentBook,
        setCurrentBook,
        currentChapterContent,
        setCurrentChapterContent,
        chatMessages,
        addChatMessage,
        clearChat,
        isSidebarOpen,
        setSidebarOpen,
        isAIPanelOpen,
        setAIPanelOpen,
        isSearchOpen,
        setSearchOpen,
        selectedText,
        setSelectedText,
    };

    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    );
}

export function useApp() {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error('useApp must be used within AppProvider');
    }
    return context;
}
