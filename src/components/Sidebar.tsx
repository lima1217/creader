import { useEffect, useState, useRef, useMemo } from 'react';
import { useLibrary, useUI, useBookProgress } from '../stores/AppContext';
import type { Book, BookCategory } from '../types';
import { getCoverUrl } from '../services/CoverStore';
import { BOOK_ITEM_HEIGHT, CATEGORY_COLORS } from '../constants';
import { useVirtualList } from '../hooks/useVirtualList';
import { useAppDialog } from './AppDialog';
import { useProximityGroup } from './useProximityGroup';
import {
    EditIcon,
    FolderIcon,
    PlusIcon,
    SettingsIcon,
    SidebarBookIcon as BookIcon,
    SidebarPanelIcon,
    TagIcon,
    TrashIcon,
} from './icons/icons';
import './Sidebar.css';

interface SidebarProps {
    onImportBook: () => void;
    onOpenSettings: () => void;
}

interface EditBookState {
    id: string;
    title: string;
    author: string;
}

// Lazy loaded book cover component
function LazyBookCover({ book, coverUrls }: { book: Book; coverUrls: Record<string, string> }) {
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
        const existingUrl = book.cover || coverUrls[book.id];
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
    }, [isVisible, book, coverUrls]);

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

export function Sidebar({ onImportBook, onOpenSettings }: SidebarProps) {
    const { confirm } = useAppDialog();
    const {
        library,
        currentBook,
        setCurrentBook,
        removeBook,
        updateBook,
        addCategory,
        removeCategory,
        updateCategory,
        setBookCategory
    } = useLibrary();
    const { bookProgressById } = useBookProgress();
    const { isSidebarOpen, setSidebarOpen } = useUI();

    const [coverUrls] = useState<Record<string, string>>({});
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

        const currentBookIndex = currentBook ? books.findIndex(book => book.id === currentBook.id) : -1;
        if (currentBookIndex <= 0) return books;

        const nextBooks = [...books];
        const [activeBook] = nextBooks.splice(currentBookIndex, 1);
        return [activeBook, ...nextBooks];
    }, [currentBook, library.books, selectedCategoryId]);

    const { containerRef: listContainerRef, virtualItems, totalHeight } = useVirtualList(filteredBooks, {
        itemHeight: BOOK_ITEM_HEIGHT,
        overscan: 3,
    });
    const headerActionsRef = useProximityGroup<HTMLDivElement>({
        radius: 96,
        maxScale: 0.08,
        minOpacity: 0.8,
    });

    const handleBookClick = (book: Book) => {
        setCurrentBook(book);
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
            removeBook(bookId);
            if (currentBook?.id === bookId) {
                setCurrentBook(null);
            }
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

    const handleEditCategory = (e: React.MouseEvent, category: BookCategory) => {
        e.stopPropagation();
        setEditingCategory(category);
        setNewCategoryName(category.name);
        setNewCategoryColor(category.color);
        setShowCategoryModal(true);
    };

    const handleDeleteCategory = async (e: React.MouseEvent, categoryId: string) => {
        e.stopPropagation();

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

    if (!isSidebarOpen) return null;

    return (
        <aside className="sidebar">
            {/* Edit Book Modal */}
            {bookToEdit && (
                <div className="modal-overlay" onClick={cancelEdit}>
                    <div className="modal modal-edit" onClick={e => e.stopPropagation()}>
                        <h3>编辑书籍</h3>
                        <div className="modal-form">
                            <div className="form-group">
                                <label htmlFor="edit-title">书名</label>
                                <input
                                    id="edit-title"
                                    type="text"
                                    value={bookToEdit.title}
                                    onChange={e => setBookToEdit({ ...bookToEdit, title: e.target.value })}
                                    onKeyDown={handleEditKeyDown}
                                    placeholder="书名"
                                    autoFocus
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="edit-author">作者</label>
                                <input
                                    id="edit-author"
                                    type="text"
                                    value={bookToEdit.author}
                                    onChange={e => setBookToEdit({ ...bookToEdit, author: e.target.value })}
                                    onKeyDown={handleEditKeyDown}
                                    placeholder="作者"
                                />
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={cancelEdit}>
                                取消
                            </button>
                            <button className="btn btn-primary" onClick={confirmEdit}>
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Category Modal */}
            {showCategoryModal && (
                <div className="modal-overlay" onClick={() => setShowCategoryModal(false)}>
                    <div className="modal modal-category" onClick={e => e.stopPropagation()}>
                        <h3>{editingCategory ? '编辑分类' : '新建分类'}</h3>
                        <div className="modal-form">
                            <div className="form-group">
                                <label htmlFor="category-name">名称</label>
                                <input
                                    id="category-name"
                                    type="text"
                                    value={newCategoryName}
                                    onChange={e => setNewCategoryName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && confirmCategoryModal()}
                                    placeholder="分类名称"
                                    autoFocus
                                />
                            </div>
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
                            <button className="btn btn-secondary" onClick={() => setShowCategoryModal(false)}>
                                取消
                            </button>
                            <button className="btn btn-primary" onClick={confirmCategoryModal} disabled={!newCategoryName.trim()}>
                                {editingCategory ? '保存' : '创建'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Assign Category Modal */}
            {bookForCategory && (
                <div className="modal-overlay" onClick={() => setBookForCategory(null)}>
                    <div className="modal modal-assign-category" onClick={e => e.stopPropagation()}>
                        <h3>设置分类</h3>
                        <div className="category-assign-list">
                            <button
                                className="category-assign-item"
                                onClick={() => confirmBookCategory(undefined)}
                            >
                                <span className="category-color" style={{ backgroundColor: 'var(--text-muted)' }} />
                                <span>不分类</span>
                            </button>
                            {categories.map(cat => (
                                <button
                                    key={cat.id}
                                    className="category-assign-item"
                                    onClick={() => confirmBookCategory(cat.id)}
                                >
                                    <span className="category-color" style={{ backgroundColor: cat.color }} />
                                    <span>{cat.name}</span>
                                </button>
                            ))}
                        </div>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setBookForCategory(null)}>
                                取消
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="sidebar-header">
                <button
                    className="btn btn-ghost btn-icon sidebar-toggle-btn"
                    onClick={() => setSidebarOpen(false)}
                    title="隐藏侧栏"
                    aria-label="隐藏侧栏"
                >
                    <SidebarPanelIcon size={23} strokeWidth={1.7} />
                </button>
                <div className="sidebar-header-actions" ref={headerActionsRef}>
                    <button className="btn btn-secondary btn-icon" data-proximity-control onClick={handleAddCategory} title="新增标签" aria-label="新增标签">
                        <FolderIcon />
                    </button>
                    <button className="btn btn-primary btn-icon sidebar-import-btn" data-proximity-control onClick={onImportBook} title="导入 EPUB" aria-label="导入 EPUB">
                        <PlusIcon />
                    </button>
                </div>
            </div>

            {/* Category Filter */}
            <div className="sidebar-categories">
                <button
                    className={`category-filter-item category-primary-item ${!selectedCategoryId || selectedCategoryId === 'all' ? 'active' : ''}`}
                    onClick={() => setSelectedCategoryId(null)}
                >
                    <BookIcon />
                    <span className="category-filter-name">全部书籍</span>
                    <span className="category-filter-count">{library.books.length}</span>
                </button>

                <div className="category-section">
                    <div
                        role="button"
                        tabIndex={0}
                        className={`category-filter-item category-primary-item ${isTagsOpen ? 'expanded' : ''}`}
                        onClick={() => setTagsOpen(open => !open)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setTagsOpen(open => !open);
                            }
                        }}
                    >
                        <TagIcon />
                        <span className="category-filter-name">标签</span>
                        <span className="category-filter-count">{categories.length}</span>
                    </div>

                    {isTagsOpen && (
                        <div className="category-children">
                            {groupedBooks.uncategorized.length > 0 && (
                                <button
                                    className={`category-filter-item category-child-item ${selectedCategoryId === 'uncategorized' ? 'active' : ''}`}
                                    onClick={() => setSelectedCategoryId('uncategorized')}
                                >
                                    <span className="category-color category-color-muted" />
                                    <span className="category-filter-name">未分类</span>
                                    <span className="category-filter-count">{groupedBooks.uncategorized.length}</span>
                                </button>
                            )}

                            {categories.map(category => (
                                <div key={category.id} className="category-filter-group">
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        className={`category-filter-item category-child-item ${selectedCategoryId === category.id ? 'active' : ''}`}
                                        onClick={() => setSelectedCategoryId(category.id)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                setSelectedCategoryId(category.id);
                                            }
                                        }}
                                    >
                                        <span className="category-color" style={{ backgroundColor: category.color }} />
                                        <span className="category-filter-name">{category.name}</span>
                                        <span className="category-filter-count">{groupedBooks[category.id]?.length || 0}</span>
                                        <div className="category-actions">
                                            <button
                                                className="btn btn-ghost btn-icon-sm"
                                                onClick={(e) => handleEditCategory(e, category)}
                                                title="编辑分类"
                                            >
                                                <EditIcon />
                                            </button>
                                            <button
                                                className="btn btn-ghost btn-icon-sm"
                                                onClick={(e) => handleDeleteCategory(e, category.id)}
                                                title="删除分类"
                                            >
                                                <TrashIcon />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="sidebar-content" ref={listContainerRef}>
                {filteredBooks.length === 0 ? (
                    <div className="sidebar-empty">
                        <div className="sidebar-empty-icon">
                            <BookIcon />
                        </div>
                        <h4>还没有书籍</h4>
                        <p>导入第一本书开始阅读</p>
                        <button className="btn btn-primary" onClick={onImportBook}>
                            <PlusIcon />
                            <span>导入书籍</span>
                        </button>
                    </div>
                ) : (
                    <div className="book-list-virtual" style={{ height: totalHeight, position: 'relative' }}>
                        {virtualItems.map(({ item: book, style }) => {
                            const percentage = bookProgressById[book.id]?.percentage ?? book.progress.percentage;
                            return (
                                <div
                                    key={book.id}
                                    className={`book-item ${currentBook?.id === book.id ? 'active' : ''}`}
                                    style={style}
                                    onClick={() => handleBookClick(book)}
                                >
                                    <LazyBookCover book={book} coverUrls={coverUrls} />
                                    <div className="book-info">
                                        <span className="book-title-row">
                                            <span className="book-title">{book.title}</span>
                                        </span>
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
                                    </div>
                                    <div className="book-actions">
                                        <button
                                            className="btn btn-ghost btn-icon book-action-btn"
                                            onClick={(e) => handleSetBookCategory(e, book.id)}
                                            title="设置分类"
                                        >
                                            <TagIcon />
                                        </button>
                                        <button
                                            className="btn btn-ghost btn-icon book-edit"
                                            onClick={(e) => handleEditBook(e, book)}
                                            title="编辑书籍信息"
                                        >
                                            <EditIcon />
                                        </button>
                                        <button
                                            className="btn btn-ghost btn-icon book-delete"
                                            onClick={(e) => handleDeleteBook(e, book.id)}
                                            title="移除书籍"
                                        >
                                            <TrashIcon />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Book count footer */}
            <div className="sidebar-footer">
                <span className="book-count">
                    {filteredBooks.length} {filteredBooks.length === 1 ? 'book' : 'books'}
                </span>
                <button className="sidebar-settings-btn" onClick={onOpenSettings}>
                    <SettingsIcon />
                    <span>设置</span>
                </button>
            </div>
        </aside>
    );
}
