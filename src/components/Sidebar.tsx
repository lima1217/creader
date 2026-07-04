import { useEffect, useState, useRef, useMemo } from 'react';
import type { SVGProps } from 'react';
import { useLibraryStore } from '../stores/libraryStore';
import { useUIStore } from '../stores/uiStore';
import { useProgressStore } from '../stores/progressStore';
import type { Book, BookFolder } from '../types';
import { getCoverUrl } from '../services/CoverStore';
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
    EditIcon,
    SettingsIcon,
    SidebarBookIcon as BookIcon,
    TrashIcon,
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
    const setBookFolder = useLibraryStore((s) => s.setBookFolder);
    const bookProgressById = useProgressStore((s) => s.bookProgressById);
    const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
    const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

    const [bookToEdit, setBookToEdit] = useState<EditBookState | null>(null);
    const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
    const [showFolderModal, setShowFolderModal] = useState(false);
    const [editingFolder, setEditingFolder] = useState<BookFolder | null>(null);
    const [isFoldersOpen, setFoldersOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [bookForFolder, setBookForFolder] = useState<string | null>(null);

    const folders = library.folders || [];

    // Group books by folder
    const groupedBooks = useMemo(() => {
        const groups: Record<string, Book[]> = {
            unfiled: []
        };

        folders.forEach(folder => {
            groups[folder.id] = [];
        });

        library.books.forEach(book => {
            if (book.folderId && groups[book.folderId]) {
                groups[book.folderId].push(book);
            } else {
                groups.unfiled.push(book);
            }
        });

        return groups;
    }, [library.books, folders]);

    // Filter books based on selected folder
    const filteredBooks = useMemo(() => {
        let books: Book[];

        if (!selectedFolderId || selectedFolderId === 'all') {
            books = library.books;
        } else if (selectedFolderId === 'unfiled') {
            books = library.books.filter(b => !b.folderId);
        } else {
            books = library.books.filter(b => b.folderId === selectedFolderId);
        }

        // Order by most-recently-read first. lastReadAt is bumped both when the
        // user opens a book and on every page turn, so frequently-read books
        // float to the top and naturally stay near the front after switching.
        // Books with no reading history keep their import order (stable sort).
        const ordered = [...books].sort((a, b) => {
            const aAt = bookProgressById[a.id]?.lastReadAt ?? a.lastReadAt ?? 0;
            const bAt = bookProgressById[b.id]?.lastReadAt ?? b.lastReadAt ?? 0;
            return bAt - aAt;
        });

        // Pin the currently-open book to the very top.
        const currentBookIndex = currentBook ? ordered.findIndex(book => book.id === currentBook.id) : -1;
        if (currentBookIndex <= 0) return ordered;

        const nextBooks = [...ordered];
        const [activeBook] = nextBooks.splice(currentBookIndex, 1);
        return [activeBook, ...nextBooks];
    }, [currentBook, library.books, selectedFolderId, bookProgressById]);

    const handleBookClick = (book: Book) => {
        openBookThroughLifecycle({ book });
    };

    const handleDeleteBook = async (e: React.MouseEvent, bookId: string) => {
        e.stopPropagation();

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

    const handleEditBook = (e: React.MouseEvent, book: Book) => {
        e.stopPropagation();
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
        setShowFolderModal(true);
    };

    const openEditFolder = (folder: BookFolder) => {
        setEditingFolder(folder);
        setNewFolderName(folder.name);
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
            if (selectedFolderId === folderId) {
                setSelectedFolderId(null);
            }
        }
    };

    const confirmFolderModal = () => {
        if (!newFolderName.trim()) return;

        if (editingFolder) {
            updateFolder(editingFolder.id, {
                name: newFolderName.trim(),
            });
        } else {
            addFolder(newFolderName.trim());
        }
        setShowFolderModal(false);
        setEditingFolder(null);
        setNewFolderName('');
    };

    const handleSetBookFolder = (e: React.MouseEvent, bookId: string) => {
        e.stopPropagation();
        setBookForFolder(bookId);
    };

    const confirmBookFolder = (folderId: string | undefined) => {
        if (bookForFolder) {
            setBookFolder(bookForFolder, folderId);
            setBookForFolder(null);
        }
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
                    <Layout height="auto" className="sidebar-dialog-layout modal-category">
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
                                    id="category-name"
                                    label="名称"
                                    value={newFolderName}
                                    onChange={setNewFolderName}
                                    onKeyDown={e => e.key === 'Enter' && confirmFolderModal()}
                                    placeholder="文件夹名称"
                                    hasAutoFocus
                                />
                            </div>
                            <div className="modal-actions">
                                <Button variant="secondary" label="取消" onClick={() => setShowFolderModal(false)} />
                                <Button
                                    variant="primary"
                                    label={editingFolder ? '保存' : '创建'}
                                    onClick={confirmFolderModal}
                                    isDisabled={!newFolderName.trim()}
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
                    className="category-assign-dialog sidebar-dialog"
                >
                    <Layout height="auto" className="sidebar-dialog-layout modal-assign-category">
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
                            <div className="category-assign-list" role="listbox" aria-label="设置书籍文件夹">
                                <button
                                    className={`category-assign-item ${!assignedFolderId ? 'selected' : ''}`}
                                    onClick={() => confirmBookFolder(undefined)}
                                    aria-pressed={!assignedFolderId}
                                >
                                    <span className="category-color muted" />
                                    <span className="category-assign-name">未归档</span>
                                    {!assignedFolderId && <span className="category-assign-current">当前</span>}
                                </button>
                                {folders.map(folder => (
                                    <button
                                        key={folder.id}
                                        className={`category-assign-item ${assignedFolderId === folder.id ? 'selected' : ''}`}
                                        onClick={() => confirmBookFolder(folder.id)}
                                        aria-pressed={assignedFolderId === folder.id}
                                    >
                                        <Icon icon={AstryxFolderIcon} size="sm" />
                                        <span className="category-assign-name">{folder.name}</span>
                                        {assignedFolderId === folder.id && <span className="category-assign-current">当前</span>}
                                    </button>
                                ))}
                            </div>
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

            {/* Folder Filter */}
            <div className="sidebar-categories">
                <SideNav>
                    <SideNavSection title="书库文件夹" isHeaderHidden>
                        <SideNavItem
                            label="全部书籍"
                            icon={AstryxBookIcon}
                            isSelected={!selectedFolderId || selectedFolderId === 'all'}
                            onClick={() => setSelectedFolderId(null)}
                            endContent={<span className="category-filter-count">{library.books.length}</span>}
                        />
                        <SideNavItem
                            label="文件夹"
                            icon={AstryxFolderIcon}
                            endContent={<span className="category-filter-count">{folders.length}</span>}
                            collapsible={{
                                isCollapsed: !isFoldersOpen,
                                onCollapsedChange: collapsed => setFoldersOpen(!collapsed),
                            }}
                        >
                            {groupedBooks.unfiled.length > 0 && (
                                <SideNavItem
                                    label="未归档"
                                    icon={AstryxMutedDotIcon}
                                    isSelected={selectedFolderId === 'unfiled'}
                                    onClick={() => setSelectedFolderId('unfiled')}
                                    endContent={<span className="category-filter-count">{groupedBooks.unfiled.length}</span>}
                                />
                            )}

                            {folders.map(folder => (
                                <div key={folder.id} className="category-filter-group">
                                    <SideNavItem
                                        label={folder.name}
                                        icon={AstryxFolderIcon}
                                        isSelected={selectedFolderId === folder.id}
                                        onClick={() => setSelectedFolderId(folder.id)}
                                        endContent={<span className="category-filter-count">{groupedBooks[folder.id]?.length || 0}</span>}
                                    />
                                    <div className="category-actions">
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
                        </SideNavItem>
                    </SideNavSection>
                </SideNav>
            </div>

            <div className="sidebar-content">
                {filteredBooks.length === 0 ? (
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
                    <List density="compact" className="book-list">
                        {filteredBooks.map((book) => {
                            const percentage = bookProgressById[book.id]?.percentage ?? book.progress.percentage;
                            return (
                                <ListItem
                                    key={book.id}
                                    className={`book-item ${currentBook?.id === book.id ? 'active' : ''}`}
                                    onMouseEnter={() => void onPreloadReader()}
                                    onClick={() => handleBookClick(book)}
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
                                            <span
                                                className="book-category-badge"
                                            >
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
                                        <button
                                            className="btn btn-ghost btn-icon book-action-btn"
                                            onClick={(e) => handleSetBookFolder(e, book.id)}
                                            aria-label="设置文件夹"
                                        >
                                            <Icon icon={AstryxFolderIcon} size="sm" />
                                        </button>
                                        <button
                                            className="btn btn-ghost btn-icon book-edit"
                                            onClick={(e) => handleEditBook(e, book)}
                                            aria-label="编辑书籍信息"
                                        >
                                            <EditIcon />
                                        </button>
                                        <button
                                            className="btn btn-ghost btn-icon book-delete"
                                            onClick={(e) => handleDeleteBook(e, book.id)}
                                            aria-label="移除书籍"
                                        >
                                            <TrashIcon />
                                        </button>
                                        </span>
                                    }
                                />
                            );
                        })}
                    </List>
                )}
            </div>

            {/* Book count footer */}
            <div className="sidebar-footer">
                <span className="book-count">
                    {filteredBooks.length} {filteredBooks.length === 1 ? 'book' : 'books'}
                </span>
                <button className="sidebar-settings-btn" onClick={onOpenSettings} aria-label="打开设置">
                    <SettingsIcon />
                    <span>设置</span>
                </button>
            </div>
        </aside>
    );
}
