import { memo, useEffect, useState, useRef, useMemo, useCallback } from 'react';
import type { SVGProps } from 'react';
import { useLibraryStore } from '../stores/libraryStore';
import { useUIStore } from '../stores/uiStore';
import { useProgressStore, selectBookProgressPercentage } from '../stores/progressStore';
import type { Book, BookFolder } from '../types';
import { getCoverUrl } from '../services/CoverStore';
import { useAppDialog } from './AppDialog';
import { openBookThroughLifecycle, removeBookThroughLifecycle } from '../appLifecycle';
import { isDuplicateFolderName, normalizeFolderName } from '../domain/libraryFolders';
import {
    groupBooksByFolder,
    orderBooks,
} from '../domain/libraryOrganizer';
import { useLibraryOrganizerExpandedFolders } from '../hooks/useLibraryOrganizerExpandedFolders';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { ContextMenu } from '@astryxdesign/core/ContextMenu';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
    CloseIcon,
    SettingsIcon,
    SidebarBookIcon as BookIcon,
} from './icons/icons';
import './Sidebar.css';
import { handleWindowDragMouseDown } from '../utils/windowDrag';

const EMPTY_BOOK_PROGRESS_BY_ID: Record<string, { lastReadAt?: number }> = {};

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

function AstryxOpenBookIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 7v14" />
            <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
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

type EditBookState = {
    id: string;
    title: string;
    author: string;
};

const BOOK_DRAG_TYPE = 'application/x-creader-book-id';
const FOLDER_DRAG_TYPE = 'application/x-creader-folder-id';
const FOLDER_AUTO_EXPAND_MS = 500;

type ActiveDrag =
    | { kind: 'book'; id: string }
    | { kind: 'folder'; id: string };

type BookDropTarget = string | 'unfiled';

function mountBookDragGhost(cover: HTMLElement): HTMLElement {
    const ghost = cover.cloneNode(true) as HTMLElement;
    ghost.classList.add('book-drag-ghost');
    ghost.querySelectorAll('img').forEach((img) => {
        img.draggable = false;
    });

    const mountTarget = cover.closest('.sidebar') ?? document.body;
    mountTarget.appendChild(ghost);
    return ghost;
}

function mountFolderDragGhost(sourceRow: HTMLElement): HTMLElement {
    const header = sourceRow.querySelector('.organizer-group-header');
    const wrapper = document.createElement('div');
    wrapper.className = 'folder-drag-ghost';

    if (header) {
        const width = Math.ceil(header.getBoundingClientRect().width);
        wrapper.style.width = `${width}px`;

        const shell = document.createElement('div');
        shell.className = 'organizer-group-header';
        shell.innerHTML = header.innerHTML;
        wrapper.appendChild(shell);
    }

    const mountTarget = sourceRow.closest('.sidebar') ?? document.body;
    mountTarget.appendChild(wrapper);
    return wrapper;
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
                <img src={loadedUrl} alt={book.title} loading="lazy" draggable={false} />
            ) : (
                <div className="book-cover-placeholder">
                    <BookIcon />
                </div>
            )}
        </div>
    );
}

type LibraryBookRowProps = {
    book: Book;
    isActive: boolean;
    isDragging: boolean;
    onPreloadReader: () => void;
    onOpen: (book: Book) => void;
    onEdit: (book: Book) => void;
    onDelete: (bookId: string) => void;
    onDragStart: (event: React.DragEvent, book: Book) => void;
    onDragEnd: () => void;
};

const LibraryBookRow = memo(function LibraryBookRow({
    book,
    isActive,
    isDragging,
    onPreloadReader,
    onOpen,
    onEdit,
    onDelete,
    onDragStart,
    onDragEnd,
}: LibraryBookRowProps) {
    const percentage = useProgressStore(
        (s) => selectBookProgressPercentage(s.bookProgressById, book.id) ?? book.progress.percentage,
    );

    return (
        <ContextMenu
            hasAutoFocus={false}
            items={[
                { label: '重命名', icon: AstryxEditIcon, onClick: () => onEdit(book) },
                { label: '移除书籍', icon: AstryxTrashIcon, onClick: () => onDelete(book.id) },
            ]}
        >
            <ListItem
                className={`book-item ${isActive ? 'active' : ''} ${isDragging ? 'is-dragging' : ''}`}
                onMouseEnter={() => void onPreloadReader()}
                onClick={() => onOpen(book)}
                draggable
                onDragStart={(event) => onDragStart(event, book)}
                onDragEnd={onDragEnd}
                isSelected={isActive}
                startContent={<LazyBookCover book={book} />}
                label={
                    <span className="book-title-row">
                        <span className="book-title">{book.title}</span>
                    </span>
                }
                description={
                    <span className="book-info">
                        <span className="book-author">{book.author || 'Unknown'}</span>
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
            />
        </ContextMenu>
    );
});

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
    const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);

    const [bookToEdit, setBookToEdit] = useState<EditBookState | null>(null);
    const [isAllFoldersExpanded, setIsAllFoldersExpanded] = useState(true);
    const [isUnfiledExpanded, setIsUnfiledExpanded] = useState(true);
    const [showFolderModal, setShowFolderModal] = useState(false);
    const [editingFolder, setEditingFolder] = useState<BookFolder | null>(null);
    const [newFolderName, setNewFolderName] = useState('');
    const [folderNameError, setFolderNameError] = useState('');
    const [draggingBookId, setDraggingBookId] = useState<string | null>(null);
    const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
    const [bookDropTargetId, setBookDropTargetId] = useState<BookDropTarget | null>(null);
    const [folderReorderTargetId, setFolderReorderTargetId] = useState<string | null>(null);
    const autoExpandTimerRef = useRef<number | null>(null);
    const activeDragRef = useRef<ActiveDrag | null>(null);
    const suppressBookClickRef = useRef(false);
    const folderDragGhostRef = useRef<HTMLElement | null>(null);
    const bookDragGhostRef = useRef<HTMLElement | null>(null);

    const folders = useMemo(
        () => [...(library.folders || [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
        [library.folders],
    );
    const { expandedFolderIds, toggleFolder, expandFolder } = useLibraryOrganizerExpandedFolders({
        folders,
        books: library.books,
        currentBook,
        // Ordering/expand use book.lastReadAt; live progress ticks must not
        // re-render the whole organizer (issue #129).
        bookProgressById: EMPTY_BOOK_PROGRESS_BY_ID,
    });
    const trimmedFolderName = normalizeFolderName(newFolderName);
    const hasDuplicateFolderName = isDuplicateFolderName(trimmedFolderName, folders, editingFolder?.id);
    const canSubmitFolder = trimmedFolderName.length > 0 && !hasDuplicateFolderName;

    const orderedBooks = useMemo(
        () => orderBooks(library.books, currentBook, EMPTY_BOOK_PROGRESS_BY_ID),
        [currentBook, library.books],
    );

    const groupedBooks = useMemo(
        () => groupBooksByFolder(orderedBooks, folders),
        [orderedBooks, folders],
    );

    const visibleBookCount = library.books.length;

    useEffect(() => () => {
        if (autoExpandTimerRef.current !== null) {
            window.clearTimeout(autoExpandTimerRef.current);
        }
    }, []);

    const handleBookClick = useCallback((book: Book) => {
        if (suppressBookClickRef.current) {
            suppressBookClickRef.current = false;
            return;
        }
        openBookThroughLifecycle({ book });
    }, []);

    const handleDeleteBookAction = useCallback(async (bookId: string) => {
        const shouldDelete = await confirm({
            title: '移出书库',
            message: '从书库移除这本书？本地 EPUB 文件会保留在磁盘上。',
            confirmLabel: '移除',
            tone: 'danger',
        });

        if (shouldDelete) {
            removeBookThroughLifecycle({ bookId });
        }
    }, [confirm]);

    const handleEditBookAction = useCallback((book: Book) => {
        setBookToEdit({
            id: book.id,
            title: book.title,
            author: book.author || '',
        });
    }, []);

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
            message: '这个文件夹里的书会回到未归档书籍。',
            confirmLabel: '删除',
            tone: 'danger',
        });

        if (shouldDelete) {
            removeFolder(folderId);
        }
    };

    const confirmFolderModal = () => {
        if (!trimmedFolderName) {
            setFolderNameError('文件夹名称不能为空');
            return;
        }
        if (hasDuplicateFolderName) {
            setFolderNameError('已存在同名文件夹');
            return;
        }

        if (editingFolder) {
            updateFolder(editingFolder.id, {
                name: trimmedFolderName,
            });
        } else {
            addFolder(trimmedFolderName);
            setIsAllFoldersExpanded(true);
        }
        setShowFolderModal(false);
        setEditingFolder(null);
        setNewFolderName('');
        setFolderNameError('');
    };

    const clearAutoExpandTimer = () => {
        if (autoExpandTimerRef.current === null) return;
        window.clearTimeout(autoExpandTimerRef.current);
        autoExpandTimerRef.current = null;
    };

    const expandFolderOnDrag = (folderId: string) => {
        expandFolder(folderId);
    };

    const moveBookToFolder = (bookId: string, folderId: string | undefined) => {
        const book = library.books.find(candidate => candidate.id === bookId);
        if (!book || book.folderId === folderId) return;
        setBookFolder(bookId, folderId);
    };

    const resolveBookDragId = (event: React.DragEvent): string => {
        const fromTransfer = event.dataTransfer.getData(BOOK_DRAG_TYPE);
        if (fromTransfer) return fromTransfer;
        if (activeDragRef.current?.kind === 'book') return activeDragRef.current.id;
        return '';
    };

    const resolveFolderDragId = (event: React.DragEvent): string => {
        const fromTransfer = event.dataTransfer.getData(FOLDER_DRAG_TYPE);
        if (fromTransfer) return fromTransfer;
        if (activeDragRef.current?.kind === 'folder') return activeDragRef.current.id;
        return '';
    };

    const finishDrag = () => {
        activeDragRef.current = null;
        setDraggingBookId(null);
        setDraggingFolderId(null);
        setBookDropTargetId(null);
        setFolderReorderTargetId(null);
        clearAutoExpandTimer();
        if (folderDragGhostRef.current) {
            folderDragGhostRef.current.remove();
            folderDragGhostRef.current = null;
        }
        if (bookDragGhostRef.current) {
            bookDragGhostRef.current.remove();
            bookDragGhostRef.current = null;
        }
    };

    const handleDragEnd = useCallback(() => {
        if (activeDragRef.current?.kind === 'book') {
            suppressBookClickRef.current = true;
        }
        finishDrag();
    }, []);

    const handleBookDragStart = useCallback((event: React.DragEvent, book: Book) => {
        activeDragRef.current = { kind: 'book', id: book.id };
        setDraggingBookId(book.id);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(BOOK_DRAG_TYPE, book.id);
        event.dataTransfer.setData('text/plain', book.id);

        const sourceRow = event.currentTarget as HTMLElement;
        const cover = sourceRow.querySelector('.book-cover') as HTMLElement | null;
        if (cover && typeof event.dataTransfer.setDragImage === 'function') {
            const ghost = mountBookDragGhost(cover);
            bookDragGhostRef.current = ghost;
            const coverRect = cover.getBoundingClientRect();
            const grabbedOnCover =
                event.clientX >= coverRect.left
                && event.clientX <= coverRect.right
                && event.clientY >= coverRect.top
                && event.clientY <= coverRect.bottom;
            const offsetX = grabbedOnCover ? event.clientX - coverRect.left : coverRect.width / 2;
            const offsetY = grabbedOnCover ? event.clientY - coverRect.top : coverRect.height / 2;
            event.dataTransfer.setDragImage(ghost, offsetX, offsetY);
        }
    }, []);

    const handleFolderDragStart = (event: React.DragEvent, folder: BookFolder) => {
        activeDragRef.current = { kind: 'folder', id: folder.id };
        setDraggingFolderId(folder.id);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(FOLDER_DRAG_TYPE, folder.id);
        event.dataTransfer.setData('text/plain', folder.id);

        const sourceRow = event.currentTarget as HTMLElement;
        if (typeof event.dataTransfer.setDragImage === 'function') {
            const ghost = mountFolderDragGhost(sourceRow);
            folderDragGhostRef.current = ghost;
            const header = sourceRow.querySelector('.organizer-group-header');
            const headerRect = header?.getBoundingClientRect();
            const offsetX = headerRect ? Math.max(16, event.clientX - headerRect.left) : 24;
            const offsetY = headerRect ? Math.max(12, event.clientY - headerRect.top) : 18;
            event.dataTransfer.setDragImage(ghost, offsetX, offsetY);
        }
    };

    const handleFolderDropTargetDragOver = (event: React.DragEvent, folderId: string | undefined) => {
        if (activeDragRef.current?.kind !== 'book') return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setBookDropTargetId(folderId ?? 'unfiled');

        if (!folderId || expandedFolderIds.has(folderId) || autoExpandTimerRef.current !== null) return;
        autoExpandTimerRef.current = window.setTimeout(() => {
            expandFolderOnDrag(folderId);
            autoExpandTimerRef.current = null;
        }, FOLDER_AUTO_EXPAND_MS);
    };

    const handleFolderDropTargetDragLeave = (event: React.DragEvent) => {
        const currentTarget = event.currentTarget as HTMLElement;
        const related = event.relatedTarget;
        if (related instanceof Node && currentTarget.contains(related)) return;
        clearAutoExpandTimer();
        setBookDropTargetId(null);
    };

    const handleFolderDropTargetDrop = (event: React.DragEvent, folderId: string | undefined) => {
        const bookId = resolveBookDragId(event);
        if (!bookId) return;
        event.preventDefault();
        finishDrag();
        moveBookToFolder(bookId, folderId);
    };

    const handleFolderReorderDragOver = (event: React.DragEvent, targetFolderId: string) => {
        if (activeDragRef.current?.kind !== 'folder') return;
        if (activeDragRef.current.id === targetFolderId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setFolderReorderTargetId(targetFolderId);
    };

    const handleFolderReorderDrop = (event: React.DragEvent, targetFolderId: string) => {
        const sourceFolderId = resolveFolderDragId(event);
        if (!sourceFolderId || sourceFolderId === targetFolderId) return;
        event.preventDefault();
        finishDrag();
        reorderFolder(sourceFolderId, targetFolderId);
    };

    const onDeleteBook = useCallback((bookId: string) => {
        void handleDeleteBookAction(bookId);
    }, [handleDeleteBookAction]);

    const renderBookItem = (book: Book) => (
        <LibraryBookRow
            key={book.id}
            book={book}
            isActive={currentBook?.id === book.id}
            isDragging={draggingBookId === book.id}
            onPreloadReader={onPreloadReader}
            onOpen={handleBookClick}
            onEdit={handleEditBookAction}
            onDelete={onDeleteBook}
            onDragStart={handleBookDragStart}
            onDragEnd={handleDragEnd}
        />
    );

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

            <div className="sidebar-header" onMouseDown={handleWindowDragMouseDown} />

            <div className="sidebar-actions">
                <Button
                    variant="ghost"
                    label="导入书籍"
                    icon={<Icon icon={AstryxPlusIcon} size="sm" />}
                    onClick={onImportBook}
                />
                <Button
                    variant="ghost"
                    label="新文件夹"
                    icon={<Icon icon={AstryxFolderIcon} size="sm" />}
                    onClick={handleAddFolder}
                />
            </div>

            <div className="sidebar-content">
                {library.books.length === 0 && folders.length === 0 ? (
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
                ) : (
                    <div className="organizer-bookshelf">
                        <section className="organizer-group all-folders-group">
                            <div className="organizer-group-header-row">
                                <button
                                    className={`organizer-group-header ${isAllFoldersExpanded ? 'expanded' : ''}`}
                                    onClick={() => setIsAllFoldersExpanded((expanded) => !expanded)}
                                >
                                    <Icon icon={AstryxFolderIcon} size="sm" />
                                    <span className="organizer-group-title">全部文件夹</span>
                                    <span className="organizer-count">{folders.length}</span>
                                    <Icon icon={AstryxChevronIcon} size="sm" />
                                </button>
                            </div>
                            {isAllFoldersExpanded && folders.length > 0 && (
                                <div className="organizer-folders-nested">
                                    {folders.map((folder) => {
                                        const isExpanded = expandedFolderIds.has(folder.id);
                                        const books = groupedBooks[folder.id] || [];
                                        const showReorderGap =
                                            folderReorderTargetId === folder.id && draggingFolderId !== folder.id;
                                        return (
                                            <section
                                                key={folder.id}
                                                className="organizer-group folder-nav-group folder-nav-group-nested"
                                                onDragOverCapture={(event) => {
                                                    handleFolderDropTargetDragOver(event, folder.id);
                                                    handleFolderReorderDragOver(event, folder.id);
                                                }}
                                                onDragLeave={handleFolderDropTargetDragLeave}
                                                onDropCapture={(event) => {
                                                    handleFolderDropTargetDrop(event, folder.id);
                                                    handleFolderReorderDrop(event, folder.id);
                                                }}
                                            >
                                                {showReorderGap && (
                                                    <div className="organizer-reorder-gap" aria-hidden="true" />
                                                )}
                                                <ContextMenu
                                                    hasAutoFocus={false}
                                                    items={[
                                                        { label: '重命名', icon: AstryxEditIcon, onClick: () => openEditFolder(folder) },
                                                        { label: '删除文件夹', icon: AstryxTrashIcon, onClick: () => void handleDeleteFolderAction(folder.id) },
                                                    ]}
                                                >
                                                    <div
                                                        className={`organizer-group-header-row folder-drag-handle ${draggingFolderId === folder.id ? 'is-folder-dragging' : ''}`}
                                                        draggable
                                                        onDragStart={(event) => {
                                                            handleFolderDragStart(event, folder);
                                                        }}
                                                        onDragEnd={handleDragEnd}
                                                    >
                                                        <button
                                                            className={`organizer-group-header ${isExpanded ? 'expanded' : ''} ${bookDropTargetId === folder.id ? 'drop-target' : ''}`}
                                                            onClick={() => toggleFolder(folder.id)}
                                                        >
                                                            <Icon icon={AstryxFolderIcon} size="sm" />
                                                            <span className="organizer-group-title">{folder.name}</span>
                                                            <span className="organizer-count">{books.length}</span>
                                                            <Icon icon={AstryxChevronIcon} size="sm" />
                                                        </button>
                                                    </div>
                                                </ContextMenu>
                                                {isExpanded && books.length > 0 && (
                                                    <List density="compact" className="book-list">
                                                        {books.map(renderBookItem)}
                                                    </List>
                                                )}
                                            </section>
                                        );
                                    })}
                                </div>
                            )}
                        </section>

                        <section
                            className="organizer-group folder-nav-group"
                            onDragOverCapture={(event) => handleFolderDropTargetDragOver(event, undefined)}
                            onDragLeave={handleFolderDropTargetDragLeave}
                            onDropCapture={(event) => handleFolderDropTargetDrop(event, undefined)}
                        >
                            <div className="organizer-group-header-row">
                                <button
                                    className={`organizer-group-header ${isUnfiledExpanded ? 'expanded' : ''} ${bookDropTargetId === 'unfiled' ? 'drop-target' : ''}`}
                                    onClick={() => setIsUnfiledExpanded((expanded) => !expanded)}
                                >
                                    <Icon icon={AstryxOpenBookIcon} size="sm" />
                                    <span className="organizer-group-title">未归档书籍</span>
                                    <span className="organizer-count">{groupedBooks.unfiled.length}</span>
                                    <Icon icon={AstryxChevronIcon} size="sm" />
                                </button>
                            </div>
                            {isUnfiledExpanded && groupedBooks.unfiled.length > 0 && (
                                <List density="compact" className="book-list">
                                    {groupedBooks.unfiled.map(renderBookItem)}
                                </List>
                            )}
                        </section>
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
