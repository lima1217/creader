import { useEffect, useState, useRef, useMemo } from 'react';
import type { SVGProps } from 'react';
import { useLibraryStore } from '../stores/libraryStore';
import { useUIStore } from '../stores/uiStore';
import { useProgressStore } from '../stores/progressStore';
import type { Book, BookCategory } from '../types';
import { getCoverUrl } from '../services/CoverStore';
import { CATEGORY_COLORS } from '../constants';
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
    TagIcon,
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

function AstryxTagIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3H4v5.59A2 2 0 0 0 4.59 10l9.58 9.59a2 2 0 0 0 2.83 0l3.59-3.59a2 2 0 0 0 0-2.83z" />
            <circle cx="7.5" cy="6.5" r="1" />
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

function makeCategoryDotIcon(color: string) {
    return function AstryxCategoryDotIcon(props: SVGProps<SVGSVGElement>) {
        return (
            <svg {...props} viewBox="0 0 24 24" fill={color}>
                <circle cx="12" cy="12" r="5" />
            </svg>
        );
    };
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
    const addCategory = useLibraryStore((s) => s.addCategory);
    const removeCategory = useLibraryStore((s) => s.removeCategory);
    const updateCategory = useLibraryStore((s) => s.updateCategory);
    const setBookCategory = useLibraryStore((s) => s.setBookCategory);
    const bookProgressById = useProgressStore((s) => s.bookProgressById);
    const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
    const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

    const [bookToEdit, setBookToEdit] = useState<EditBookState | null>(null);
    const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [editingCategory, setEditingCategory] = useState<BookCategory | null>(null);
    const [isTagsOpen, setTagsOpen] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategoryColor, setNewCategoryColor] = useState<string>(CATEGORY_COLORS[0]);
    const [bookForCategory, setBookForCategory] = useState<string | null>(null);

    // Safely access categories with fallback
    const categories = library.categories || [];

    // Group books by category
    const groupedBooks = useMemo(() => {
        const groups: Record<string, Book[]> = {
            uncategorized: []
        };

        // Initialize groups for each category
        categories.forEach(cat => {
            groups[cat.id] = [];
        });

        // Distribute books
        library.books.forEach(book => {
            if (book.categoryId && groups[book.categoryId]) {
                groups[book.categoryId].push(book);
            } else {
                groups.uncategorized.push(book);
            }
        });

        return groups;
    }, [library.books, categories]);

    // Filter books based on selected category
    const filteredBooks = useMemo(() => {
        let books: Book[];

        if (!selectedCategoryId || selectedCategoryId === 'all') {
            books = library.books;
        } else if (selectedCategoryId === 'uncategorized') {
            books = library.books.filter(b => !b.categoryId);
        } else {
            books = library.books.filter(b => b.categoryId === selectedCategoryId);
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
    }, [currentBook, library.books, selectedCategoryId, bookProgressById]);

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

    const handleAddCategory = () => {
        setEditingCategory(null);
        setNewCategoryName('');
        setNewCategoryColor(CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)]);
        setShowCategoryModal(true);
    };

    const openEditCategory = (category: BookCategory) => {
        setEditingCategory(category);
        setNewCategoryName(category.name);
        setNewCategoryColor(category.color);
        setShowCategoryModal(true);
    };

    const handleDeleteCategoryAction = async (categoryId: string) => {
        const shouldDelete = await confirm({
            title: 'Delete category',
            message: 'Books in this category will become uncategorized.',
            confirmLabel: 'Delete',
            tone: 'danger',
        });

        if (shouldDelete) {
            removeCategory(categoryId);
            if (selectedCategoryId === categoryId) {
                setSelectedCategoryId(null);
            }
        }
    };

    const confirmCategoryModal = () => {
        if (!newCategoryName.trim()) return;

        if (editingCategory) {
            updateCategory(editingCategory.id, {
                name: newCategoryName.trim(),
                color: newCategoryColor
            });
        } else {
            addCategory(newCategoryName.trim(), newCategoryColor);
        }
        setShowCategoryModal(false);
        setEditingCategory(null);
        setNewCategoryName('');
    };

    const handleSetBookCategory = (e: React.MouseEvent, bookId: string) => {
        e.stopPropagation();
        setBookForCategory(bookId);
    };

    const confirmBookCategory = (categoryId: string | undefined) => {
        if (bookForCategory) {
            setBookCategory(bookForCategory, categoryId);
            setBookForCategory(null);
        }
    };

    const bookForCategoryRecord = bookForCategory ? library.books.find(book => book.id === bookForCategory) : null;
    const assignedCategoryId = bookForCategoryRecord?.categoryId;

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

            {/* Category Modal */}
            {showCategoryModal && (
                <Dialog
                    isOpen={showCategoryModal}
                    onOpenChange={(open) => { if (!open) setShowCategoryModal(false); }}
                    width={450}
                    purpose="info"
                    className="modal-overlay sidebar-dialog"
                >
                    <Layout height="auto" className="sidebar-dialog-layout modal-category">
                        <DialogHeader
                            className="sidebar-dialog-header"
                            title={editingCategory ? '编辑分类' : '新建分类'}
                            hasDivider={false}
                            endContent={(
                                <Button
                                    variant="ghost"
                                    label="关闭"
                                    isIconOnly
                                    icon={<CloseIcon />}
                                    onClick={() => setShowCategoryModal(false)}
                                />
                            )}
                        />
                        <LayoutContent className="sidebar-dialog-content">
                            <div className="modal-form">
                                <TextInput
                                    id="category-name"
                                    label="名称"
                                    value={newCategoryName}
                                    onChange={setNewCategoryName}
                                    onKeyDown={e => e.key === 'Enter' && confirmCategoryModal()}
                                    placeholder="分类名称"
                                    hasAutoFocus
                                />
                                <div className="form-group">
                                    <label>颜色</label>
                                    <div className="color-picker">
                                        {CATEGORY_COLORS.map(color => (
                                            <button
                                                key={color}
                                                className={`color-option ${newCategoryColor === color ? 'selected' : ''}`}
                                                style={{ backgroundColor: color }}
                                                onClick={() => setNewCategoryColor(color)}
                                                type="button"
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div className="modal-actions">
                                <Button variant="secondary" label="取消" onClick={() => setShowCategoryModal(false)} />
                                <Button
                                    variant="primary"
                                    label={editingCategory ? '保存' : '创建'}
                                    onClick={confirmCategoryModal}
                                    isDisabled={!newCategoryName.trim()}
                                />
                            </div>
                        </LayoutContent>
                    </Layout>
                </Dialog>
            )}

            {/* Assign Category Modal */}
            {bookForCategory && (
                <Dialog
                    isOpen={bookForCategory !== null}
                    onOpenChange={(open) => { if (!open) setBookForCategory(null); }}
                    width={340}
                    purpose="info"
                    className="category-assign-dialog sidebar-dialog"
                >
                    <Layout height="auto" className="sidebar-dialog-layout modal-assign-category">
                        <DialogHeader
                            className="sidebar-dialog-header"
                            title="设置分类"
                            hasDivider={false}
                            endContent={(
                                <Button
                                    variant="ghost"
                                    label="关闭"
                                    isIconOnly
                                    icon={<CloseIcon />}
                                    onClick={() => setBookForCategory(null)}
                                />
                            )}
                        />
                        <LayoutContent className="sidebar-dialog-content">
                            <div className="category-assign-list" role="listbox" aria-label="设置书籍分类">
                                <button
                                    className={`category-assign-item ${!assignedCategoryId ? 'selected' : ''}`}
                                    onClick={() => confirmBookCategory(undefined)}
                                    aria-pressed={!assignedCategoryId}
                                >
                                    <span className="category-color muted" />
                                    <span className="category-assign-name">不分类</span>
                                    {!assignedCategoryId && <span className="category-assign-current">当前</span>}
                                </button>
                                {categories.map(cat => (
                                    <button
                                        key={cat.id}
                                        className={`category-assign-item ${assignedCategoryId === cat.id ? 'selected' : ''}`}
                                        onClick={() => confirmBookCategory(cat.id)}
                                        aria-pressed={assignedCategoryId === cat.id}
                                    >
                                        <span className="category-color" style={{ backgroundColor: cat.color }} />
                                        <span className="category-assign-name">{cat.name}</span>
                                        {assignedCategoryId === cat.id && <span className="category-assign-current">当前</span>}
                                    </button>
                                ))}
                            </div>
                            <div className="modal-actions">
                                <Button variant="secondary" label="取消" onClick={() => setBookForCategory(null)} />
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
                        label="新增标签"
                        icon={<Icon icon={AstryxFolderIcon} size="sm" />}
                        onClick={handleAddCategory}
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

            {/* Category Filter */}
            <div className="sidebar-categories">
                <SideNav>
                    <SideNavSection title="书库分类" isHeaderHidden>
                        <SideNavItem
                            label="全部书籍"
                            icon={AstryxBookIcon}
                            isSelected={!selectedCategoryId || selectedCategoryId === 'all'}
                            onClick={() => setSelectedCategoryId(null)}
                            endContent={<span className="category-filter-count">{library.books.length}</span>}
                        />
                        <SideNavItem
                            label="标签"
                            icon={AstryxTagIcon}
                            endContent={<span className="category-filter-count">{categories.length}</span>}
                            collapsible={{
                                isCollapsed: !isTagsOpen,
                                onCollapsedChange: collapsed => setTagsOpen(!collapsed),
                            }}
                        >
                            {groupedBooks.uncategorized.length > 0 && (
                                <SideNavItem
                                    label="未分类"
                                    icon={AstryxMutedDotIcon}
                                    isSelected={selectedCategoryId === 'uncategorized'}
                                    onClick={() => setSelectedCategoryId('uncategorized')}
                                    endContent={<span className="category-filter-count">{groupedBooks.uncategorized.length}</span>}
                                />
                            )}

                            {categories.map(category => (
                                <div key={category.id} className="category-filter-group">
                                    <SideNavItem
                                        label={category.name}
                                        icon={makeCategoryDotIcon(category.color)}
                                        isSelected={selectedCategoryId === category.id}
                                        onClick={() => setSelectedCategoryId(category.id)}
                                        endContent={<span className="category-filter-count">{groupedBooks[category.id]?.length || 0}</span>}
                                    />
                                    <div className="category-actions">
                                        <MoreMenu
                                            label={`${category.name} 操作`}
                                            size="sm"
                                            items={[
                                                { label: '编辑分类', icon: AstryxEditIcon, onClick: () => openEditCategory(category) },
                                                { label: '删除分类', icon: AstryxTrashIcon, onClick: () => void handleDeleteCategoryAction(category.id) },
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
                                        {book.categoryId && (
                                            <span
                                                className="book-category-badge"
                                                style={{
                                                    backgroundColor: categories.find(c => c.id === book.categoryId)?.color || 'var(--text-muted)',
                                                    opacity: 0.8
                                                }}
                                            >
                                                {categories.find(c => c.id === book.categoryId)?.name || ''}
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
                                            onClick={(e) => handleSetBookCategory(e, book.id)}
                                            aria-label="设置分类"
                                        >
                                            <TagIcon />
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
