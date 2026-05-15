import { useState, useEffect, createContext, useContext, ReactNode, useRef, useCallback, useMemo } from 'react';
import type { Settings, Book, Library, ChatMessage, BookCategory, BookProgressUpdate, ReadingProgress } from '../types';
import { dataUrlToBlob, deleteCover, revokeCoverUrl, saveCover } from '../services/CoverStore';
import { loadStored, STORAGE_KEYS } from '../services/LocalStore';
import { validateAndFixLibraryPaths } from '../services/BookPathValidator';
import { MAX_CHAT_MESSAGES_STORED } from '../constants';
import { appendChatMessages, clearChatMessages, loadChatMessages, replaceChatMessages } from '../services/ChatStore';
import { createLogger } from '../utils/logger';
import { perfSpan } from '../utils/perf';
import { useDebouncedPersist } from '../hooks/useDebouncedPersist';
import { BookProgressById, getInitialBookProgressById, getInitialChatMessages, getInitialLibrary, getInitialSettings } from './app/initialState';

const logger = createLogger('AppContext');

// Default settings
const defaultSettings: Settings = {
    theme: 'light',
    fontSize: 16,
    fontFamily: 'Georgia',
    lineHeight: 1.6,
    allowEpubScripts: true,
    allowAIDangerousPermissions: false,
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
    updateBookProgress: (id: string, update: BookProgressUpdate) => void;
    bookProgressById: BookProgressById;

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
    setChatMessages: (messages: ChatMessage[]) => void;
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

    // Accumulated texts for cross-page selection
    accumulatedTexts: string[];
    addToAccumulatedTexts: (text: string) => void;
    removeAccumulatedText: (index: number) => void;
    clearAccumulatedTexts: () => void;
}

const AppContext = createContext<AppState | null>(null);

type SettingsContextValue = Pick<AppState, 'settings' | 'setSettings'>;
type LibraryContextValue = Pick<
    AppState,
    | 'library'
    | 'setLibrary'
    | 'addBook'
    | 'removeBook'
    | 'updateBook'
    | 'updateBookFilePath'
    | 'addCategory'
    | 'removeCategory'
    | 'updateCategory'
    | 'setBookCategory'
    | 'currentBook'
    | 'setCurrentBook'
>;
type ProgressContextValue = Pick<AppState, 'bookProgressById' | 'updateBookProgress'>;
type UIContextValue = Pick<AppState, 'isSidebarOpen' | 'setSidebarOpen' | 'isAIPanelOpen' | 'setAIPanelOpen' | 'isSearchOpen' | 'setSearchOpen'>;
type AIContextValue = Pick<
    AppState,
    | 'currentChapterContent'
    | 'setCurrentChapterContent'
    | 'chatMessages'
    | 'addChatMessage'
    | 'setChatMessages'
    | 'clearChat'
    | 'selectedText'
    | 'setSelectedText'
    | 'accumulatedTexts'
    | 'addToAccumulatedTexts'
    | 'removeAccumulatedText'
    | 'clearAccumulatedTexts'
>;

const SettingsContext = createContext<SettingsContextValue | null>(null);
const LibraryContext = createContext<LibraryContextValue | null>(null);
const ProgressContext = createContext<ProgressContextValue | null>(null);
const UIContext = createContext<UIContextValue | null>(null);
const AIContext = createContext<AIContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
    // Settings
    const [settings, setSettingsState] = useState<Settings>(() => getInitialSettings(defaultSettings));

    // Library
    const [library, setLibraryState] = useState<Library>(() => getInitialLibrary());

    // Current book
    const [currentBook, setCurrentBookState] = useState<Book | null>(null);

    const latestLibraryRef = useRef<Library | null>(null);
    const latestCurrentBookRef = useRef<Book | null>(null);

    // Current chapter content for AI
    const [currentChapterContent, setCurrentChapterContent] = useState<string>('');

    // Chat - hydrated asynchronously from IndexedDB
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => getInitialChatMessages());

    const [bookProgressById, setBookProgressById] = useState<BookProgressById>(() => getInitialBookProgressById());

    // Selected text
    const [selectedText, setSelectedTextState] = useState<string>('');

    // Wrapper to log selectedText changes
    const setSelectedText = useCallback((text: string) => {
        logger.debug('setSelectedText called with:', text ? text.slice(0, 50) : '(empty)');
        setSelectedTextState(text);
    }, []);

    // Accumulated texts for cross-page selection
    const [accumulatedTexts, setAccumulatedTexts] = useState<string[]>([]);

    const addToAccumulatedTexts = useCallback((text: string) => {
        if (text.trim()) {
            setAccumulatedTexts(prev => [...prev, text.trim()]);
        }
    }, []);

    const removeAccumulatedText = useCallback((index: number) => {
        setAccumulatedTexts(prev => prev.filter((_, i) => i !== index));
    }, []);

    const clearAccumulatedTexts = useCallback(() => {
        setAccumulatedTexts([]);
    }, []);

    // UI State
    const [isSidebarOpen, setSidebarOpen] = useState(true);
    const [isAIPanelOpen, setAIPanelOpen] = useState(false);
    const [isSearchOpen, setSearchOpen] = useState(false);

    useEffect(() => {
        latestLibraryRef.current = library;
    }, [library]);

    useEffect(() => {
        latestCurrentBookRef.current = currentBook;
    }, [currentBook]);

    // Apply theme
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', settings.theme);
    }, [settings.theme]);

    useDebouncedPersist(STORAGE_KEYS.settings, settings, 500, { skipInitial: true });
    useDebouncedPersist(STORAGE_KEYS.library, library, 800, { skipInitial: true });
    useDebouncedPersist(STORAGE_KEYS.progress, bookProgressById, 800, { skipInitial: true });

    useEffect(() => {
        let cancelled = false;

        const toMigrate = library.books.filter(b => !!b.cover && b.cover.startsWith('data:') && !b.coverKey);
        if (toMigrate.length === 0) return;

        const migrateCovers = async () => {
            await perfSpan('startup:migrateCovers', async () => {
                const migratedIds = new Set<string>();
                for (const book of toMigrate) {
                    if (cancelled) return;
                    try {
                        const blob = await dataUrlToBlob(book.cover as string);
                        await saveCover(book.id, blob);
                        migratedIds.add(book.id);
                    } catch (e) {
                        logger.error('Failed to migrate cover:', e);
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
            });
        };

        const scheduleIdle = () => {
            const w = window as unknown as {
                requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
                cancelIdleCallback?: (handle: number) => void;
            };

            if (typeof w.requestIdleCallback === 'function') {
                const handle = w.requestIdleCallback(() => void migrateCovers(), { timeout: 3500 });
                return () => w.cancelIdleCallback?.(handle);
            }

            const timer = window.setTimeout(() => void migrateCovers(), 1200);
            return () => window.clearTimeout(timer);
        };

        const cancelSchedule = scheduleIdle();

        return () => {
            cancelled = true;
            cancelSchedule();
        };
    }, [library.books]);

    // Validate and fix book paths on startup (important for packaged apps)
    const pathValidationRan = useRef(false);
    useEffect(() => {
        // Only run once on startup
        if (pathValidationRan.current) return;
        pathValidationRan.current = true;

        let cancelled = false;

        const validatePaths = async () => {
            const snapshot = latestLibraryRef.current;
            if (!snapshot || snapshot.books.length === 0) return;

            try {
                const result = await perfSpan('startup:validateAndFixLibraryPaths', async () => {
                    return await validateAndFixLibraryPaths(snapshot);
                });

                if (cancelled) return;

                // Log results
                if (result.fixedBooks.length > 0) {
                    logger.debug(`Fixed paths for ${result.fixedBooks.length} book(s)`);
                }
                if (result.brokenBooks.length > 0) {
                    logger.warn(`Could not find files for ${result.brokenBooks.length} book(s)`);
                }

                // Update library if paths were fixed
                if (result.fixedBooks.length > 0) {
                    setLibraryState((prev) => {
                        // Don't clobber state if the library changed while we were validating.
                        if (prev.lastUpdated !== snapshot.lastUpdated) return prev;
                        return result.updatedLibrary;
                    });

                    const current = latestCurrentBookRef.current;
                    if (current && result.fixedBooks.includes(current.id)) {
                        const updated = result.updatedLibrary.books.find(b => b.id === current.id);
                        if (updated && updated.filePath !== current.filePath) {
                            setCurrentBookState(prev => prev?.id === current.id ? { ...prev, filePath: updated.filePath } : prev);
                        }
                    }
                }
            } catch (error) {
                logger.error('Failed to validate book paths:', error);
            }
        };

        const scheduleIdle = () => {
            const w = window as unknown as {
                requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
                cancelIdleCallback?: (handle: number) => void;
            };

            if (typeof w.requestIdleCallback === 'function') {
                const handle = w.requestIdleCallback(() => void validatePaths(), { timeout: 2000 });
                return () => w.cancelIdleCallback?.(handle);
            }

            // Fallback: defer a bit longer so first interaction feels snappy.
            const timer = window.setTimeout(() => void validatePaths(), 1200);
            return () => window.clearTimeout(timer);
        };

        const cancelSchedule = scheduleIdle();

        return () => {
            cancelled = true;
            cancelSchedule();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        let cancelled = false;

        const hydrateChat = async () => {
            try {
                const stored = await loadChatMessages(MAX_CHAT_MESSAGES_STORED);
                if (cancelled) return;

                if (stored.length > 0) {
                    setChatMessages(stored);
                    return;
                }

                // Migrate legacy localStorage chat once.
                const legacy = loadStored<ChatMessage[]>(STORAGE_KEYS.chat, []);
                if (legacy.length > 0) {
                    const trimmed = legacy.slice(-MAX_CHAT_MESSAGES_STORED);
                    await replaceChatMessages(trimmed, MAX_CHAT_MESSAGES_STORED);
                    localStorage.removeItem(STORAGE_KEYS.chat);
                    if (!cancelled) setChatMessages(trimmed);
                }
            } catch (error) {
                logger.warn('Failed to hydrate chat messages:', error);
            }
        };

        // Defer so initial reader UI can settle first.
        const w = window as unknown as {
            requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
            cancelIdleCallback?: (handle: number) => void;
        };

        const cancel = (() => {
            if (typeof w.requestIdleCallback === 'function') {
                const handle = w.requestIdleCallback(() => void hydrateChat(), { timeout: 1500 });
                return () => w.cancelIdleCallback?.(handle);
            }
            const timer = window.setTimeout(() => void hydrateChat(), 600);
            return () => window.clearTimeout(timer);
        })();

        return () => {
            cancelled = true;
            cancel();
        };
    }, []);

    // Setters
    const setSettings = useCallback((newSettings: Settings) => {
        setSettingsState(newSettings);
    }, []);

    const setLibrary = useCallback((newLibrary: Library) => {
        setLibraryState(newLibrary);
    }, []);

    const addBook = useCallback((book: Book) => {
        setLibraryState(prev => ({
            ...prev,
            books: [...prev.books, book],
            lastUpdated: Date.now(),
        }));
        setBookProgressById(prev => ({
            ...prev,
            [book.id]: { ...book.progress, lastReadAt: book.lastReadAt ?? 0 },
        }));
    }, []);

    const removeBook = useCallback((id: string) => {
        // Find the book to get its file path
        const book = library.books.find(b => b.id === id);

        void deleteCover(id);
        revokeCoverUrl(id);
        setBookProgressById(prev => {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
        });

        // Delete the book file if it's in the app's books directory
        if (book?.filePath) {
            import('@tauri-apps/api/core').then(({ invoke }) => {
                invoke('delete_book_file', { filePath: book.filePath })
                    .catch(err => logger.warn('Failed to delete book file:', err));
            }).catch(() => {
                // Not running in Tauri environment
            });
        }

        setLibraryState(prev => ({
            ...prev,
            books: prev.books.filter(b => b.id !== id),
            lastUpdated: Date.now(),
        }));
    }, [library.books]);

    const updateBook = useCallback((id: string, updates: Partial<Pick<Book, 'title' | 'author' | 'categoryId'>>) => {
        setLibraryState(prev => ({
            ...prev,
            books: prev.books.map(b =>
                b.id === id ? { ...b, ...updates } : b
            ),
            lastUpdated: Date.now(),
        }));
        setCurrentBookState(prev => prev?.id === id ? { ...prev, ...updates } : prev);
    }, []);

    const updateBookFilePath = useCallback((id: string, newFilePath: string) => {
        setLibraryState(prev => ({
            ...prev,
            books: prev.books.map(b =>
                b.id === id ? { ...b, filePath: newFilePath } : b
            ),
            lastUpdated: Date.now(),
        }));
        setCurrentBookState(prev => prev?.id === id ? { ...prev, filePath: newFilePath } : prev);
    }, []);

    const updateBookProgress = useCallback((id: string, update: BookProgressUpdate) => {
        const lastReadAt = Date.now();

        const progress: ReadingProgress = (() => {
            switch (update.kind) {
                case 'epub':
                default:
                    return {
                        currentCfi: update.currentCfi,
                        percentage: update.percentage,
                    };
            }
        })();

        setBookProgressById(prev => ({
            ...prev,
            [id]: { ...progress, lastReadAt },
        }));
    }, []);

    const setCurrentBook = useCallback((book: Book | null) => {
        if (!book) {
            setCurrentBookState(null);
            return;
        }

        const storedProgress = bookProgressById[book.id];
        if (!storedProgress) {
            setCurrentBookState(book);
            return;
        }

        const { lastReadAt: storedLastReadAt, ...progress } = storedProgress;

        setCurrentBookState({
            ...book,
            progress: {
                ...book.progress,
                ...progress,
            },
            lastReadAt: storedLastReadAt || book.lastReadAt,
        });
    }, [bookProgressById]);

    // Category management
    const addCategory = useCallback((name: string, color: string): BookCategory => {
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
    }, []);

    const removeCategory = useCallback((id: string) => {
        setLibraryState(prev => ({
            ...prev,
            categories: (prev.categories || []).filter(c => c.id !== id),
            // Also remove category assignment from books
            books: prev.books.map(b =>
                b.categoryId === id ? { ...b, categoryId: undefined } : b
            ),
            lastUpdated: Date.now(),
        }));
    }, []);

    const updateCategory = useCallback((id: string, updates: Partial<Pick<BookCategory, 'name' | 'color'>>) => {
        setLibraryState(prev => ({
            ...prev,
            categories: (prev.categories || []).map(c =>
                c.id === id ? { ...c, ...updates } : c
            ),
            lastUpdated: Date.now(),
        }));
    }, []);

    const setBookCategory = useCallback((bookId: string, categoryId: string | undefined) => {
        setLibraryState(prev => ({
            ...prev,
            books: prev.books.map(b =>
                b.id === bookId ? { ...b, categoryId } : b
            ),
            lastUpdated: Date.now(),
        }));
    }, []);

    const addChatMessage = useCallback((message: ChatMessage) => {
        setChatMessages(prev => {
            const next = [...prev, message];
            void appendChatMessages([message], MAX_CHAT_MESSAGES_STORED).catch((e) => {
                logger.warn('Failed to persist chat message:', e);
            });
            return next.length > MAX_CHAT_MESSAGES_STORED ? next.slice(-MAX_CHAT_MESSAGES_STORED) : next;
        });
    }, []);

    const setChatMessagesFn = useCallback((messages: ChatMessage[]) => {
        setChatMessages(messages);
        void replaceChatMessages(messages, MAX_CHAT_MESSAGES_STORED).catch((e) => {
            logger.warn('Failed to persist chat messages:', e);
        });
    }, []);

    const clearChat = useCallback(() => {
        setChatMessages([]);
        void clearChatMessages().catch((e) => {
            logger.warn('Failed to clear chat messages:', e);
        });
    }, []);

    const value: AppState = useMemo(() => ({
        settings,
        setSettings,
        library,
        setLibrary,
        addBook,
        removeBook,
        updateBook,
        updateBookFilePath,
        updateBookProgress,
        bookProgressById,
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
        setChatMessages: setChatMessagesFn,
        clearChat,
        isSidebarOpen,
        setSidebarOpen,
        isAIPanelOpen,
        setAIPanelOpen,
        isSearchOpen,
        setSearchOpen,
        selectedText,
        setSelectedText,
        accumulatedTexts,
        addToAccumulatedTexts,
        removeAccumulatedText,
        clearAccumulatedTexts,
    }), [
        settings,
        setSettings,
        library,
        setLibrary,
        addBook,
        removeBook,
        updateBook,
        updateBookFilePath,
        updateBookProgress,
        bookProgressById,
        addCategory,
        removeCategory,
        updateCategory,
        setBookCategory,
        currentBook,
        setCurrentBook,
        currentChapterContent,
        chatMessages,
        addChatMessage,
        setChatMessagesFn,
        clearChat,
        isSidebarOpen,
        isAIPanelOpen,
        isSearchOpen,
        selectedText,
        setSelectedText,
        accumulatedTexts,
        addToAccumulatedTexts,
        removeAccumulatedText,
        clearAccumulatedTexts,
    ]);

    const settingsContextValue = useMemo<SettingsContextValue>(() => ({
        settings,
        setSettings,
    }), [settings, setSettings]);

    const libraryContextValue = useMemo<LibraryContextValue>(() => ({
        library,
        setLibrary,
        addBook,
        removeBook,
        updateBook,
        updateBookFilePath,
        addCategory,
        removeCategory,
        updateCategory,
        setBookCategory,
        currentBook,
        setCurrentBook,
    }), [
        library,
        setLibrary,
        addBook,
        removeBook,
        updateBook,
        updateBookFilePath,
        addCategory,
        removeCategory,
        updateCategory,
        setBookCategory,
        currentBook,
        setCurrentBook,
    ]);

    const progressContextValue = useMemo<ProgressContextValue>(() => ({
        bookProgressById,
        updateBookProgress,
    }), [bookProgressById, updateBookProgress]);

    const uiContextValue = useMemo<UIContextValue>(() => ({
        isSidebarOpen,
        setSidebarOpen,
        isAIPanelOpen,
        setAIPanelOpen,
        isSearchOpen,
        setSearchOpen,
    }), [isSidebarOpen, isAIPanelOpen, isSearchOpen]);

    const aiContextValue = useMemo<AIContextValue>(() => ({
        currentChapterContent,
        setCurrentChapterContent,
        chatMessages,
        addChatMessage,
        setChatMessages: setChatMessagesFn,
        clearChat,
        selectedText,
        setSelectedText,
        accumulatedTexts,
        addToAccumulatedTexts,
        removeAccumulatedText,
        clearAccumulatedTexts,
    }), [
        currentChapterContent,
        chatMessages,
        addChatMessage,
        setChatMessagesFn,
        clearChat,
        selectedText,
        setSelectedText,
        accumulatedTexts,
        addToAccumulatedTexts,
        removeAccumulatedText,
        clearAccumulatedTexts,
    ]);

    return (
        <SettingsContext.Provider value={settingsContextValue}>
            <LibraryContext.Provider value={libraryContextValue}>
                <ProgressContext.Provider value={progressContextValue}>
                    <UIContext.Provider value={uiContextValue}>
                        <AIContext.Provider value={aiContextValue}>
                            <AppContext.Provider value={value}>
                                {children}
                            </AppContext.Provider>
                        </AIContext.Provider>
                    </UIContext.Provider>
                </ProgressContext.Provider>
            </LibraryContext.Provider>
        </SettingsContext.Provider>
    );
}

export function useApp() {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error('useApp must be used within AppProvider');
    }
    return context;
}

export function useSettings() {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error('useSettings must be used within AppProvider');
    }
    return context;
}

export function useLibrary() {
    const context = useContext(LibraryContext);
    if (!context) {
        throw new Error('useLibrary must be used within AppProvider');
    }
    return context;
}

export function useBookProgress() {
    const context = useContext(ProgressContext);
    if (!context) {
        throw new Error('useBookProgress must be used within AppProvider');
    }
    return context;
}

export function useUI() {
    const context = useContext(UIContext);
    if (!context) {
        throw new Error('useUI must be used within AppProvider');
    }
    return context;
}

export function useAI() {
    const context = useContext(AIContext);
    if (!context) {
        throw new Error('useAI must be used within AppProvider');
    }
    return context;
}
