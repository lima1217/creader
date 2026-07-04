import { useEffect, useState, useRef, useMemo } from 'react';
import type { SVGProps } from 'react';
import { useLibraryStore } from '../stores/libraryStore';
import { useUIStore } from '../stores/uiStore';
import { useProgressStore } from '../stores/progressStore';
import type { Book, BookFolder } from '../types';
import { getCoverUrl } from '../services/CoverStore';
import { STORAGE_KEYS, loadStored, saveStored } from '../services/LocalStore';
import { useAppDialog } from './AppDialog';
import { openBookThroughLifecycle, removeBookThroughLifecycle } from '../appLifecycle';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
    CloseIcon,
    SettingsIcon,
    SidebarBookIcon as BookIcon,
} from './icons/icons';
import './Sidebar.css';

function AstryxSidebarPanelIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <rect x="5" y="4" width="14" height="16" rx="3.2" />
            <line x1="10" y1="7" x2="10" y2="17" />
        </svg>
    );
}

function AstryxFolderIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
    );
}

function AstryxPlusIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    );
}

function AstryxBookIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
        </svg>
    );
}

function AstryxEditIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
    );
}

function AstryxTrashIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6 18 20H6L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
        </svg>
    );
}

function AstryxMutedDotIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="5" />
        </svg>
    );
}

function AstryxSearchIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
        </svg>
    );
}

function AstryxChevronIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m9 18 6-6-6-6" />
        </svg>
    );
}

interface SidebarProps {
    onImportBook: () => void;
    onOpenSettings: () => void;
    onPreloadReader: () => Promise<unknown>;
}

interface EditBookState {
    id: string;
    title: string;
    author: string;
}

type OrganizerView = 'all' | 'unfiled' | string;

interface BookGroup {
    id: string;
    label: string;
    books: Book[];
    isFolder: boolean;
}

const BOOK_DRAG_TYPE = 'application/x-creader-book-id';
const FOLDER_DRAG_TYPE = 'application/x-creader-folder-id';
const FOLDER_AUTO_EXPAND_MS = 500;

function getBookActivity(book: Book, bookProgressById: Record<string, { lastReadAt?: number }>): number {
    return bookProgressById[book.id]?.lastReadAt ?? book.lastReadAt ?? 0;
}

function orderBooks(books: Book[], currentBook: Book | null, bookProgressById: Record<string, { lastReadAt?: number }>): Book[] {
    const ordered = [...books].sort((a, b) => getBookActivity(b, bookProgressById) - getBookActivity(a, bookProgressById));
    const currentBookIndex = currentBook ? ordered.findIndex(book => book.id === currentBook.id) : -1;
    if (currentBookIndex <= 0) return ordered;

    const nextBooks = [...ordered];
    const [activeBook] = nextBooks.splice(currentBookIndex, 1);
    return [activeBook, ...nextBooks];
}

function matchesBookSearch(book: Book, query: string): boolean {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return true;
    return book.title.toLocaleLowerCase().includes(normalized)
        || (book.author || '').toLocaleLowerCase().includes(normalized);
}

function loadExpandedFolderIds(): Set<string> {
    return new Set(loadStored<string[]>(STORAGE_KEYS.libraryOrganizerExpandedFolders, []));
}

function getBookDragId(event: React.DragEvent): string {
    return event.dataTransfer.getData(BOOK_DRAG_TYPE);
}

function getFolderDragId(event: React.DragEvent): string {
    return event.dataTransfer.getData(FOLDER_DRAG_TYPE);
}

// Lazy loaded book cover component
function LazyBookCover({ book }: { book: Book }) {
    const [isVisible, setIsVisible] = useState(false);
    const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setIsVisible(true);
                        observer.disconnect();
                    }
                });
            },
            { rootMargin: '100px', threshold: 0 }
        );

        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!isVisible) return;

        // Check if we already have the URL
        const existingUrl = book.cover;
        if (existingUrl) {
            setLoadedUrl(existingUrl);
            return;
        }

        // Need to load from IndexedDB
        if (book.coverKey) {
            getCoverUrl(book.coverKey).then((url) => {
                if (url) setLoadedUrl(url);
            }).catch(() => { });
        }
    }, [isVisible, book]);

    return (
        <div ref={ref} className="book-cover">
            {loadedUrl ? (
                <img src={loadedUrl} alt={book.title} loading="lazy" />
            ) : (
                <div className="book-cover-placeholder">
                    <BookIcon />
                </div>
            )}
        </div>
    );
}

export function Sidebar({ onImportBook, onOpenSettings, onPreloadReader }: SidebarProps) {
    const { confirm } = useAppDialog();
    const library = useLibraryStore((s) => s.library);
    const currentBook = useLibraryStore((s) => s.currentBook);
    const updateBook = useLibraryStore((s) => s.updateBook);
    const addFolder = useLibraryStore((s) => s.addFolder);
    const removeFolder = useLibraryStore((s) => s.removeFolder);
    const updateFolder = useLibraryStore((s) => s.updateFolder);
    const reorderFolder = useLibraryStore((s) => s.reorderFolder);
    const setBookFolder = useLibraryStore((s) => s.setBookFolder);
    const bookProgressById = useProgressStore((s) => s.bookProgressById);
    const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
    const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

    const [bookToEdit, setBookToEdit] = useState<EditBookState | null>(null);
    const [selectedView, setSelectedView] = useState<OrganizerView>('all');
    const [showFolderModal, setShowFolderModal] = useState(false);
    const [editingFolder, setEditingFolder] = useState<BookFolder | null>(null);
    const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(loadExpandedFolderIds);
    const [newFolderName, setNewFolderName] = useState('');
    const [folderNameError, setFolderNameError] = useState('');
    const [bookForFolder, setBookForFolder] = useState<string | null>(null);
    const [bookSearchQuery, setBookSearchQuery] = useState('');
    const hasPrimedCurrentFolderRef = useRef(false);
    const autoExpandTimerRef = useRef<number | null>(null);

    const folders = useMemo(
        () => [...(library.folders || [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
        [library.folders],
    );
    const folderIds = useMemo(() => new Set(folders.map(folder => folder.id)), [folders]);
    const hasSearch = bookSearchQuery.trim().length > 0;
    const trimmedFolderName = newFolderName.trim();
    const isDuplicateFolderName = folders.some(folder =>
        folder.id !== editingFolder?.id
        && folder.name.toLocaleLowerCase() === trimmedFolderName.toLocaleLowerCase(),
    );
    const canSubmitFolder = trimmedFolderName.length > 0 && !isDuplicateFolderName;

    const orderedBooks = useMemo(
        () => orderBooks(library.books, currentBook, bookProgressById),
        [currentBook, library.books, bookProgressById],
    );

    const continueBook = currentBook ?? orderedBooks[0] ?? null;

    const groupedBooks = useMemo(() => {
        const groups: Record<string, Book[]> = {
            unfiled: []
        };

        folders.forEach(folder => {
            groups[folder.id] = [];
        });

        orderedBooks.forEach(book => {
            if (book.folderId && groups[book.folderId]) {
                groups[book.folderId].push(book);
            } else {
                groups.unfiled.push(book);
            }
        });

        return groups;
    }, [orderedBooks, folders]);

    const visibleGroups = useMemo<BookGroup[]>(() => {
        const allGroups: BookGroup[] = [
            { id: 'unfiled', label: '未归档', books: groupedBooks.unfiled || [], isFolder: false },
            ...folders.map(folder => ({
                id: folder.id,
                label: folder.name,
                books: groupedBooks[folder.id] || [],
                isFolder: true,
            })),
        ];

        const scopedGroups = selectedView === 'all'
            ? allGroups
            : allGroups.filter(group => group.id === selectedView);

        if (!hasSearch) return scopedGroups;

        return allGroups
            .map(group => ({
                ...group,
                books: group.books.filter(book => matchesBookSearch(book, bookSearchQuery)),
            }))
            .filter(group => group.books.length > 0);
    }, [bookSearchQuery, folders, groupedBooks, hasSearch, selectedView]);

    const visibleBookCount = visibleGroups.reduce((count, group) => count + group.books.length, 0);

    useEffect(() => {
        if (folders.length > 0 && localStorage.getItem(STORAGE_KEYS.libraryOrganizerExpandedFolders) === null) {
            const next = new Set(folders.map(folder => folder.id));
            setExpandedFolderIds(next);
            saveStored(STORAGE_KEYS.libraryOrganizerExpandedFolders, Array.from(next));
            return;
        }

        const currentFolderId = currentBook?.folderId;
        if (hasPrimedCurrentFolderRef.current || !currentFolderId || !folderIds.has(currentFolderId)) return;
        hasPrimedCurrentFolderRef.current = true;
        setExpandedFolderIds((current) => {
            if (current.has(currentFolderId)) return current;
            const next = new Set(current);
            next.add(currentFolderId);
            saveStored(STORAGE_KEYS.libraryOrganizerExpandedFolders, Array.from(next));
            return next;
        });
    }, [currentBook?.folderId, folderIds, folders]);

    useEffect(() => {
        setExpandedFolderIds((current) => {
            const next = new Set(Array.from(current).filter(id => folderIds.has(id)));
            if (next.size === current.size) return current;
            saveStored(STORAGE_KEYS.libraryOrganizerExpandedFolders, Array.from(next));
            return next;
        });
    }, [folderIds]);

    useEffect(() => () => {
        if (autoExpandTimerRef.current !== null) {
            window.clearTimeout(autoExpandTimerRef.current);
        }
    }, []);

    const toggleFolder = (folderId: string) => {
        setExpandedFolderIds((current) => {
            const next = new Set(current);
            if (next.has(folderId)) {
                next.delete(folderId);
            } else {
                next.add(folderId);
            }
            saveStored(STORAGE_KEYS.libraryOrganizerExpandedFolders, Array.from(next));
            return next;
        });
    };

    const handleBookClick = (book: Book) => {
        openBookThroughLifecycle({ book });
    };

    const handleDeleteBookAction = async (bookId: string) => {
        const shouldDelete = await confirm({
            title: '移出书库',
            message: '从书库移除这本书？本地 EPUB 文件会保留在磁盘上。',
            confirmLabel: '移除',
            tone: 'danger',
        });

        if (shouldDelete) {
            removeBookThroughLifecycle({ bookId });
        }
    };

    const handleEditBookAction = (book: Book) => {
        setBookToEdit({
            id: book.id,
            title: book.title,
            author: book.author || '',
        });
    };

    const confirmEdit = () => {
        if (bookToEdit) {
            updateBook(bookToEdit.id, {
                title: bookToEdit.title.trim() || 'Untitled',
                author: bookToEdit.author.trim(),
            });
            setBookToEdit(null);
        }
    };

    const cancelEdit = () => {
        setBookToEdit(null);
    };

    const handleEditKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            confirmEdit();
        } else if (e.key === 'Escape') {
            cancelEdit();
        }
    };

    const handleAddFolder = () => {
        setEditingFolder(null);
        setNewFolderName('');
        setFolderNameError('');
        setShowFolderModal(true);
    };

    const openEditFolder = (folder: BookFolder) => {
        setEditingFolder(folder);
        setNewFolderName(folder.name);
        setFolderNameError('');
        setShowFolderModal(true);
    };

    const handleDeleteFolderAction = async (folderId: string) => {
        const shouldDelete = await confirm({
            title: '删除文件夹',
            message: '这个文件夹里的书会回到未归档。',
            confirmLabel: '删除',
            tone: 'danger',
        });

        if (shouldDelete) {
            removeFolder(folderId);
            if (selectedView === folderId) {
                setSelectedView('all');
            }
        }
    };

    const confirmFolderModal = () => {
        if (!trimmedFolderName) {
            setFolderNameError('文件夹名称不能为空');
            return;
        }
        if (isDuplicateFolderName) {
            setFolderNameError('已存在同名文件夹');
            return;
        }

        if (editingFolder) {
            updateFolder(editingFolder.id, {
                name: trimmedFolderName,
            });
        } else {
            addFolder(trimmedFolderName);
        }
        setShowFolderModal(false);
        setEditingFolder(null);
        setNewFolderName('');
        setFolderNameError('');
    };

    const handleSetBookFolder = (bookId: string) => {
        setBookForFolder(bookId);
    };

    const confirmBookFolder = (folderId: string | undefined) => {
        if (bookForFolder) {
            setBookFolder(bookForFolder, folderId);
            setBookForFolder(null);
        }
    };

    const clearAutoExpandTimer = () => {
        if (autoExpandTimerRef.current === null) return;
        window.clearTimeout(autoExpandTimerRef.current);
        autoExpandTimerRef.current = null;
    };

    const expandFolder = (folderId: string) => {
        setExpandedFolderIds((current) => {
            if (current.has(folderId)) return current;
            const next = new Set(current);
            next.add(folderId);
            saveStored(STORAGE_KEYS.libraryOrganizerExpandedFolders, Array.from(next));
            return next;
        });
    };

    const moveBookToFolder = (bookId: string, folderId: string | undefined) => {
        const book = library.books.find(candidate => candidate.id === bookId);
        if (!book || book.folderId === folderId) return;
        setBookFolder(bookId, folderId);
    };

    const handleBookDragStart = (event: React.DragEvent, book: Book) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(BOOK_DRAG_TYPE, book.id);
    };

    const handleFolderDragStart = (event: React.DragEvent, folder: BookFolder) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(FOLDER_DRAG_TYPE, folder.id);
    };

    const handleFolderDropTargetDragOver = (event: React.DragEvent, folderId: string | undefined) => {
        if (!getBookDragId(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';

        if (!folderId || expandedFolderIds.has(folderId) || autoExpandTimerRef.current !== null) return;
        autoExpandTimerRef.current = window.setTimeout(() => {
            expandFolder(folderId);
            autoExpandTimerRef.current = null;
        }, FOLDER_AUTO_EXPAND_MS);
    };

    const handleFolderDropTargetDragLeave = () => {
        clearAutoExpandTimer();
    };

    const handleFolderDropTargetDrop = (event: React.DragEvent, folderId: string | undefined) => {
        const bookId = getBookDragId(event);
        if (!bookId) return;
        event.preventDefault();
        clearAutoExpandTimer();
        moveBookToFolder(bookId, folderId);
    };

    const handleFolderReorderDragOver = (event: React.DragEvent) => {
        if (!getFolderDragId(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    };

    const handleFolderReorderDrop = (event: React.DragEvent, targetFolderId: string) => {
        const sourceFolderId = getFolderDragId(event);
        if (!sourceFolderId || sourceFolderId === targetFolderId) return;
        event.preventDefault();
        reorderFolder(sourceFolderId, targetFolderId);
    };

    const renderBookItem = (book: Book) => {
        const percentage = bookProgressById[book.id]?.percentage ?? book.progress.percentage;
        return (
            <ListItem
                key={book.id}
                className={`book-item ${currentBook?.id === book.id ? 'active' : ''}`}
                onMouseEnter={() => void onPreloadReader()}
                onClick={() => handleBookClick(book)}
                draggable
                onDragStart={(event) => handleBookDragStart(event, book)}
                isSelected={currentBook?.id === book.id}
                startContent={<LazyBookCover book={book} />}
                label={
                    <span className="book-title-row">
                        <span className="book-title">{book.title}</span>
                    </span>
                }
                description={
                    <span className="book-info">
                        <span className="book-author">{book.author || 'Unknown'}</span>
                        {book.folderId && (
                            <span className="book-folder-badge">
                                {folders.find(folder => folder.id === book.folderId)?.name || ''}
                            </span>
                        )}
                        {percentage > 0 && (
                            <div className="book-progress">
                                <div
                                    className="book-progress-bar"
                                    style={{ '--book-progress-scale': percentage / 100 } as React.CSSProperties}
                                />
                            </div>
                        )}
                    </span>
                }
                endContent={
                    <span className="book-actions">
                        <MoreMenu
                            label={`${book.title} 操作`}
                            size="sm"
                            items={[
                                { label: '移动到文件夹', icon: AstryxFolderIcon, onClick: () => handleSetBookFolder(book.id) },
                                { label: '编辑书籍信息', icon: AstryxEditIcon, onClick: () => handleEditBookAction(book) },
                                { label: '移除书籍', icon: AstryxTrashIcon, onClick: () => void handleDeleteBookAction(book.id) },
                            ]}
                        />
                    </span>
                }
            />
        );
    };

    const bookForFolderRecord = bookForFolder ? library.books.find(book => book.id === bookForFolder) : null;
    const assignedFolderId = bookForFolderRecord?.folderId;

    if (!isSidebarOpen) return null;

    return (
        <aside className="sidebar">
            {/* Edit Book Modal */}
            {bookToEdit && (
                <Dialog
                    isOpen={bookToEdit !== null}
                    onOpenChange={(open) => { if (!open) cancelEdit(); }}
                    width={450}
                    purpose="info"
                    className="modal-overlay sidebar-dialog"
                >
                    <Layout height="auto" className="sidebar-dialog-layout modal-edit">
                        <DialogHeader
                            className="sidebar-dialog-header"
                            title="编辑书籍"
                            hasDivider={false}
                            endContent={(
                                <Button
                                    variant="ghost"
                                    label="关闭"
                                    isIconOnly
                                    icon={<CloseIcon />}
                                    onClick={cancelEdit}
                                />
                            )}
                        />
                        <LayoutContent className="sidebar-dialog-content">
                            <div className="modal-form">
                                <TextInput
                                    id="edit-title"
                                    label="书名"
                                    value={bookToEdit.title}
                                    onChange={value => setBookToEdit({ ...bookToEdit, title: value })}
                                    onKeyDown={handleEditKeyDown}
                                    placeholder="书名"
                                    hasAutoFocus
                                />
                                <TextInput
                                    id="edit-author"
                                    label="作者"
                                    value={bookToEdit.author}
                                    onChange={value => setBookToEdit({ ...bookToEdit, author: value })}
                                    onKeyDown={handleEditKeyDown}
                                    placeholder="作者"
                                />
                            </div>
                            <div className="modal-actions">
                                <Button variant="secondary" label="取消" onClick={cancelEdit} />
                                <Button variant="primary" label="保存" onClick={confirmEdit} />
                            </div>
                        </LayoutContent>
                    </Layout>
                </Dialog>
            )}

            {/* Folder Modal */}
            {showFolderModal && (
                <Dialog
                    isOpen={showFolderModal}
                    onOpenChange={(open) => { if (!open) setShowFolderModal(false); }}
                    width={450}
                    purpose="info"
                    className="modal-overlay sidebar-dialog"
                >
                    <Layout height="auto" className="sidebar-dialog-layout modal-folder">
                        <DialogHeader
                            className="sidebar-dialog-header"
                            title={editingFolder ? '编辑文件夹' : '新建文件夹'}
                            hasDivider={false}
                            endContent={(
                                <Button
                                    variant="ghost"
                                    label="关闭"
                                    isIconOnly
                                    icon={<CloseIcon />}
                                    onClick={() => setShowFolderModal(false)}
                                />
                            )}
                        />
                        <LayoutContent className="sidebar-dialog-content">
                            <div className="modal-form">
                                <TextInput
                                    id="folder-name"
                                    label="名称"
                                    value={newFolderName}
                                    onChange={(value) => {
                                        setNewFolderName(value);
                                        setFolderNameError('');
                                    }}
                                    onKeyDown={e => e.key === 'Enter' && confirmFolderModal()}
                                    placeholder="文件夹名称"
                                    hasAutoFocus
                                />
                                {folderNameError && <p className="folder-name-error" role="alert">{folderNameError}</p>}
                            </div>
                            <div className="modal-actions">
                                <Button variant="secondary" label="取消" onClick={() => setShowFolderModal(false)} />
                                <Button
                                    variant="primary"
                                    label={editingFolder ? '保存' : '创建'}
                                    onClick={confirmFolderModal}
                                    isDisabled={!canSubmitFolder}
                                />
                            </div>
                        </LayoutContent>
                    </Layout>
                </Dialog>
            )}

            {/* Assign Folder Modal */}
            {bookForFolder && (
                <Dialog
                    isOpen={bookForFolder !== null}
                    onOpenChange={(open) => { if (!open) setBookForFolder(null); }}
                    width={340}
                    purpose="info"
                    className="folder-assign-dialog sidebar-dialog"
                >
                    <Layout height="auto" className="sidebar-dialog-layout modal-assign-folder">
                        <DialogHeader
                            className="sidebar-dialog-header"
                            title="设置文件夹"
                            hasDivider={false}
                            endContent={(
                                <Button
                                    variant="ghost"
                                    label="关闭"
                                    isIconOnly
                                    icon={<CloseIcon />}
                                    onClick={() => setBookForFolder(null)}
                                />
                            )}
                        />
                        <LayoutContent className="sidebar-dialog-content">
                            <List density="compact" className="folder-assign-list" aria-label="设置书籍文件夹">
                                <ListItem
                                    className="folder-assign-item"
                                    label="未归档"
                                    onClick={() => confirmBookFolder(undefined)}
                                    isSelected={!assignedFolderId}
                                    startContent={<span className="folder-muted-dot" />}
                                    endContent={!assignedFolderId ? <span className="folder-assign-current">当前</span> : undefined}
                                />
                                {folders.map(folder => (
                                    <ListItem
                                        key={folder.id}
                                        className="folder-assign-item"
                                        label={folder.name}
                                        onClick={() => confirmBookFolder(folder.id)}
                                        isSelected={assignedFolderId === folder.id}
                                        startContent={<Icon icon={AstryxFolderIcon} size="sm" />}
                                        endContent={assignedFolderId === folder.id ? <span className="folder-assign-current">当前</span> : undefined}
                                    />
                                ))}
                            </List>
                            <div className="modal-actions">
                                <Button variant="secondary" label="取消" onClick={() => setBookForFolder(null)} />
                            </div>
                        </LayoutContent>
                    </Layout>
                </Dialog>
            )}

            <div className="sidebar-header">
                <IconButton
                    variant="ghost"
                    size="sm"
                    label="隐藏侧栏"
                    icon={<Icon icon={AstryxSidebarPanelIcon} size="md" />}
                    onClick={() => setSidebarOpen(false)}
                />
                <div className="sidebar-header-actions">
                    <IconButton
                        variant="ghost"
                        size="sm"
                        label="新增文件夹"
                        icon={<Icon icon={AstryxFolderIcon} size="sm" />}
                        onClick={handleAddFolder}
                    />
                    <IconButton
                        variant="ghost"
                        size="sm"
                        label="导入 EPUB"
                        icon={<Icon icon={AstryxPlusIcon} size="sm" />}
                        onClick={onImportBook}
                    />
                </div>
            </div>

            <div className="sidebar-continue">
                {continueBook ? (
                    <button
                        className="continue-book"
                        onMouseEnter={() => void onPreloadReader()}
                        onClick={() => handleBookClick(continueBook)}
                    >
                        <span className="continue-book-label">继续阅读</span>
                        <span className="continue-book-title">{continueBook.title}</span>
                        <span className="continue-book-author">{continueBook.author || 'Unknown'}</span>
                    </button>
                ) : (
                    <div className="continue-book empty">
                        <span className="continue-book-label">继续阅读</span>
                        <span className="continue-book-title">暂无书籍</span>
                    </div>
                )}
            </div>

            <div className="sidebar-search">
                <TextInput
                    label="搜索书库"
                    isLabelHidden
                    value={bookSearchQuery}
                    onChange={setBookSearchQuery}
                    placeholder="搜索书名或作者"
                    startIcon={AstryxSearchIcon}
                    hasClear
                    size="sm"
                />
            </div>

            <div className="sidebar-organizer-nav">
                <SideNav>
                    <SideNavSection title="书库整理" isHeaderHidden>
                        <SideNavItem
                            label="全部书籍"
                            icon={AstryxBookIcon}
                            isSelected={selectedView === 'all'}
                            onClick={() => setSelectedView('all')}
                            endContent={<span className="organizer-count">{library.books.length}</span>}
                        />
                        <div
                            className="folder-drop-target"
                            onDragOver={(event) => handleFolderDropTargetDragOver(event, undefined)}
                            onDragLeave={handleFolderDropTargetDragLeave}
                            onDrop={(event) => handleFolderDropTargetDrop(event, undefined)}
                        >
                            <SideNavItem
                                label="未归档"
                                icon={AstryxMutedDotIcon}
                                isSelected={selectedView === 'unfiled'}
                                onClick={() => setSelectedView('unfiled')}
                                endContent={<span className="organizer-count">{groupedBooks.unfiled.length}</span>}
                            />
                        </div>
                        {folders.map(folder => (
                            <div
                                key={folder.id}
                                className="folder-nav-group"
                                draggable
                                onDragStart={(event) => handleFolderDragStart(event, folder)}
                                onDragOver={(event) => {
                                    handleFolderDropTargetDragOver(event, folder.id);
                                    handleFolderReorderDragOver(event);
                                }}
                                onDragLeave={handleFolderDropTargetDragLeave}
                                onDrop={(event) => {
                                    handleFolderDropTargetDrop(event, folder.id);
                                    handleFolderReorderDrop(event, folder.id);
                                }}
                            >
                                <SideNavItem
                                    label={folder.name}
                                    icon={AstryxFolderIcon}
                                    isSelected={selectedView === folder.id}
                                    onClick={() => {
                                        setSelectedView(folder.id);
                                        if (!expandedFolderIds.has(folder.id)) toggleFolder(folder.id);
                                    }}
                                    endContent={<span className="organizer-count">{groupedBooks[folder.id]?.length || 0}</span>}
                                />
                                <div className="folder-actions">
                                    <MoreMenu
                                        label={`${folder.name} 操作`}
                                        size="sm"
                                        items={[
                                            { label: '编辑文件夹', icon: AstryxEditIcon, onClick: () => openEditFolder(folder) },
                                            { label: '删除文件夹', icon: AstryxTrashIcon, onClick: () => void handleDeleteFolderAction(folder.id) },
                                        ]}
                                    />
                                </div>
                            </div>
                        ))}
                    </SideNavSection>
                </SideNav>
            </div>

            <div className="sidebar-content">
                {library.books.length === 0 ? (
                    <div className="sidebar-empty">
                        <EmptyState
                            isCompact
                            headingLevel={4}
                            title="还没有书籍"
                            description="导入第一本书开始阅读"
                            icon={<Icon icon={AstryxBookIcon} />}
                            actions={
                                <Button
                                    variant="primary"
                                    label="导入书籍"
                                    icon={<Icon icon={AstryxPlusIcon} size="sm" />}
                                    onClick={onImportBook}
                                />
                            }
                        />
                    </div>
                ) : visibleBookCount === 0 ? (
                    <div className="sidebar-empty compact">
                        <EmptyState
                            isCompact
                            headingLevel={4}
                            title="没有匹配书籍"
                            description="试试书名或作者里的其他字词"
                            icon={<Icon icon={AstryxSearchIcon} />}
                        />
                    </div>
                ) : (
                    <div className="organizer-bookshelf">
                        {visibleGroups.map((group) => {
                            const isExpanded = hasSearch || !group.isFolder || expandedFolderIds.has(group.id);
                            return (
                                <section key={group.id} className="organizer-group">
                                    <button
                                        className={`organizer-group-header ${isExpanded ? 'expanded' : ''}`}
                                        onDragOver={(event) => handleFolderDropTargetDragOver(event, group.isFolder ? group.id : undefined)}
                                        onDragLeave={handleFolderDropTargetDragLeave}
                                        onDrop={(event) => handleFolderDropTargetDrop(event, group.isFolder ? group.id : undefined)}
                                        onClick={() => {
                                            if (group.isFolder && !hasSearch) {
                                                toggleFolder(group.id);
                                            } else {
                                                setSelectedView(group.id);
                                            }
                                        }}
                                    >
                                        <Icon icon={group.isFolder ? AstryxFolderIcon : AstryxMutedDotIcon} size="sm" />
                                        <span className="organizer-group-title">{group.label}</span>
                                        <span className="organizer-count">{group.books.length}</span>
                                        {group.isFolder && (
                                            <Icon icon={AstryxChevronIcon} size="sm" />
                                        )}
                                    </button>
                                    {isExpanded && (
                                        <List density="compact" className="book-list">
                                            {group.books.map(renderBookItem)}
                                        </List>
                                    )}
                                </section>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Book count footer */}
            <div className="sidebar-footer">
                <span className="book-count">
                    {visibleBookCount} {visibleBookCount === 1 ? 'book' : 'books'}
                </span>
                <button className="sidebar-settings-btn" onClick={onOpenSettings} aria-label="打开设置">
                    <SettingsIcon />
                    <span>设置</span>
                </button>
            </div>
        </aside>
    );
}
