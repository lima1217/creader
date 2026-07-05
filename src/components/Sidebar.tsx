import { useEffect, useState, useRef, useMemo } from 'react';
import type { SVGProps } from 'react';
import { useLibraryStore } from '../stores/libraryStore';
import { useUIStore } from '../stores/uiStore';
import { useProgressStore } from '../stores/progressStore';
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
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import type { DropdownMenuOption } from '@astryxdesign/core/DropdownMenu';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
    CloseIcon,
    SettingsIcon,
    SidebarBookIcon as BookIcon,
} from './icons/icons';
import './Sidebar.css';

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

function AstryxChevronIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m9 18 6-6-6-6" />
        </svg>
    );
}

function AstryxMoreHorizontalIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="19" cy="12" r="1.7" />
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

function FolderMoreMenu({
    label,
    items,
}: {
    label: string;
    items: DropdownMenuOption[];
}) {
    return (
        <DropdownMenu
            button={{
                label,
                icon: <Icon icon={AstryxMoreHorizontalIcon} size="sm" />,
                variant: 'ghost',
                size: 'sm',
                isIconOnly: true,
            }}
            items={items}
            hasChevron={false}
        />
    );
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

    const [bookToEdit, setBookToEdit] = useState<EditBookState | null>(null);
    const [isUnfiledExpanded, setIsUnfiledExpanded] = useState(true);
    const [showFolderModal, setShowFolderModal] = useState(false);
    const [editingFolder, setEditingFolder] = useState<BookFolder | null>(null);
    const [newFolderName, setNewFolderName] = useState('');
    const [folderNameError, setFolderNameError] = useState('');
    const [bookForFolder, setBookForFolder] = useState<string | null>(null);
    const autoExpandTimerRef = useRef<number | null>(null);

    const folders = useMemo(
        () => [...(library.folders || [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
        [library.folders],
    );
    const { expandedFolderIds, toggleFolder, expandFolder } = useLibraryOrganizerExpandedFolders({
        folders,
        books: library.books,
        currentBook,
        bookProgressById,
    });
    const trimmedFolderName = normalizeFolderName(newFolderName);
    const hasDuplicateFolderName = isDuplicateFolderName(trimmedFolderName, folders, editingFolder?.id);
    const canSubmitFolder = trimmedFolderName.length > 0 && !hasDuplicateFolderName;

    const orderedBooks = useMemo(
        () => orderBooks(library.books, currentBook, bookProgressById),
        [currentBook, library.books, bookProgressById],
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

    const expandFolderOnDrag = (folderId: string) => {
        expandFolder(folderId);
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
            expandFolderOnDrag(folderId);
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
                    <span
                        className="book-actions"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <DropdownMenu
                            button={{
                                label: `${book.title} 操作`,
                                icon: <Icon icon={AstryxMoreHorizontalIcon} size="sm" />,
                                variant: 'ghost',
                                size: 'sm',
                                isIconOnly: true,
                            }}
                            items={[
                                { label: '移动到文件夹', icon: AstryxFolderIcon, onClick: () => handleSetBookFolder(book.id) },
                                { label: '编辑书籍信息', icon: AstryxEditIcon, onClick: () => handleEditBookAction(book) },
                                { label: '移除书籍', icon: AstryxTrashIcon, onClick: () => void handleDeleteBookAction(book.id) },
                            ]}
                            hasChevron={false}
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

            <div className="sidebar-header" />

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
                        <section className="organizer-group folder-nav-group">
                            <div className="organizer-group-header-row">
                                <button
                                    className={`organizer-group-header ${isUnfiledExpanded ? 'expanded' : ''}`}
                                    onDragOver={(event) => handleFolderDropTargetDragOver(event, undefined)}
                                    onDragLeave={handleFolderDropTargetDragLeave}
                                    onDrop={(event) => handleFolderDropTargetDrop(event, undefined)}
                                    onClick={() => setIsUnfiledExpanded((expanded) => !expanded)}
                                >
                                    <Icon icon={AstryxMutedDotIcon} size="sm" />
                                    <span className="organizer-group-title">未归档</span>
                                    <span className="organizer-count">{groupedBooks.unfiled.length}</span>
                                    <Icon icon={AstryxChevronIcon} size="sm" />
                                </button>
                                <div className="folder-actions folder-actions-placeholder" aria-hidden="true">
                                    <DropdownMenu
                                        button={{
                                            label: '未归档占位',
                                            icon: <Icon icon={AstryxMoreHorizontalIcon} size="sm" />,
                                            variant: 'ghost',
                                            size: 'sm',
                                            isIconOnly: true,
                                        }}
                                        items={[]}
                                        hasChevron={false}
                                    />
                                </div>
                            </div>
                            {isUnfiledExpanded && groupedBooks.unfiled.length > 0 && (
                                <List density="compact" className="book-list">
                                    {groupedBooks.unfiled.map(renderBookItem)}
                                </List>
                            )}
                        </section>

                        {folders.map((folder) => {
                            const isExpanded = expandedFolderIds.has(folder.id);
                            const books = groupedBooks[folder.id] || [];
                            return (
                                <section
                                    key={folder.id}
                                    className="organizer-group folder-nav-group"
                                    draggable
                                    onDragStart={(event) => {
                                        if ((event.target as HTMLElement).closest('.book-item')) return;
                                        handleFolderDragStart(event, folder);
                                    }}
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
                                    <div className="organizer-group-header-row">
                                        <button
                                            className={`organizer-group-header ${isExpanded ? 'expanded' : ''}`}
                                            onClick={() => toggleFolder(folder.id)}
                                        >
                                            <Icon icon={AstryxFolderIcon} size="sm" />
                                            <span className="organizer-group-title">{folder.name}</span>
                                            <span className="organizer-count">{books.length}</span>
                                            <Icon icon={AstryxChevronIcon} size="sm" />
                                        </button>
                                        <div className="folder-actions">
                                            <FolderMoreMenu
                                                label={`${folder.name} 操作`}
                                                items={[
                                                    { label: '编辑文件夹', icon: AstryxEditIcon, onClick: () => openEditFolder(folder) },
                                                    { label: '删除文件夹', icon: AstryxTrashIcon, onClick: () => void handleDeleteFolderAction(folder.id) },
                                                ]}
                                            />
                                        </div>
                                    </div>
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
