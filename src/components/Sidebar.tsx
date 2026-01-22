import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useApp } from '../stores/AppContext';
import type { Book, BookCategory } from '../types';
import { getCoverUrl } from '../services/CoverStore';
import { BOOK_ITEM_HEIGHT, CATEGORY_COLORS } from '../constants';
import './Sidebar.css';

// Icons as simple SVG components
const BookIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
);

const PlusIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

const TrashIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
);

const EditIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
);

const FolderIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
);

const TagIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
);

interface SidebarProps {
    onImportBook: () => void;
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

export function Sidebar({ onImportBook }: SidebarProps) {
    const {
        library,
        currentBook,
        setCurrentBook,
        removeBook,
        updateBook,
        isSidebarOpen,
        addCategory,
        removeCategory,
        updateCategory,
        setBookCategory
    } = useApp();

    const [coverUrls] = useState<Record<string, string>>({});
    const [bookToDelete, setBookToDelete] = useState<string | null>(null);
    const [bookToEdit, setBookToEdit] = useState<EditBookState | null>(null);
    const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [editingCategory, setEditingCategory] = useState<BookCategory | null>(null);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategoryColor, setNewCategoryColor] = useState<string>(CATEGORY_COLORS[0]);
    const [bookForCategory, setBookForCategory] = useState<string | null>(null);
    const [categoryToDelete, setCategoryToDelete] = useState<string | null>(null);

    const listContainerRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [containerHeight, setContainerHeight] = useState(0);

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
        if (!selectedCategoryId || selectedCategoryId === 'all') {
            return library.books;
        }
        if (selectedCategoryId === 'uncategorized') {
            return library.books.filter(b => !b.categoryId);
        }
        return library.books.filter(b => b.categoryId === selectedCategoryId);
    }, [library.books, selectedCategoryId]);

    // Virtual list calculations
    const visibleRange = useMemo(() => {
        const overscan = 3;
        const start = Math.max(0, Math.floor(scrollTop / BOOK_ITEM_HEIGHT) - overscan);
        const visibleCount = Math.ceil(containerHeight / BOOK_ITEM_HEIGHT);
        const end = Math.min(filteredBooks.length - 1, start + visibleCount + overscan * 2);
        return { start, end };
    }, [scrollTop, containerHeight, filteredBooks.length]);

    const virtualItems = useMemo(() => {
        const result: Array<{ index: number; book: Book; style: React.CSSProperties }> = [];
        for (let i = visibleRange.start; i <= visibleRange.end && i < filteredBooks.length; i++) {
            result.push({
                index: i,
                book: filteredBooks[i],
                style: {
                    position: 'absolute',
                    top: i * BOOK_ITEM_HEIGHT,
                    left: 0,
                    right: 0,
                    height: BOOK_ITEM_HEIGHT,
                },
            });
        }
        return result;
    }, [filteredBooks, visibleRange]);

    const totalHeight = filteredBooks.length * BOOK_ITEM_HEIGHT;

    // Handle scroll for virtual list
    const handleScroll = useCallback(() => {
        if (listContainerRef.current) {
            setScrollTop(listContainerRef.current.scrollTop);
        }
    }, []);

    // Observe container size
    useEffect(() => {
        const container = listContainerRef.current;
        if (!container) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerHeight(entry.contentRect.height);
            }
        });

        resizeObserver.observe(container);
        setContainerHeight(container.clientHeight);
        container.addEventListener('scroll', handleScroll, { passive: true });

        return () => {
            resizeObserver.disconnect();
            container.removeEventListener('scroll', handleScroll);
        };
    }, [handleScroll]);

    const handleBookClick = (book: Book) => {
        setCurrentBook(book);
    };

    const handleDeleteBook = (e: React.MouseEvent, bookId: string) => {
        e.stopPropagation();
        setBookToDelete(bookId);
    };

    const confirmDelete = () => {
        if (bookToDelete) {
            removeBook(bookToDelete);
            if (currentBook?.id === bookToDelete) {
                setCurrentBook(null);
            }
            setBookToDelete(null);
        }
    };

    const cancelDelete = () => {
        setBookToDelete(null);
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

    const handleDeleteCategory = (e: React.MouseEvent, categoryId: string) => {
        e.stopPropagation();
        setCategoryToDelete(categoryId);
    };

    const confirmDeleteCategory = () => {
        if (categoryToDelete) {
            removeCategory(categoryToDelete);
            if (selectedCategoryId === categoryToDelete) {
                setSelectedCategoryId(null);
            }
            setCategoryToDelete(null);
        }
    };

    const cancelDeleteCategory = () => {
        setCategoryToDelete(null);
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
            {/* Delete Confirmation Modal */}
            {bookToDelete && (
                <div className="modal-overlay" onClick={cancelDelete}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <h3>Delete Book</h3>
                        <p>Are you sure you want to remove this book from your library?</p>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={cancelDelete}>
                                Cancel
                            </button>
                            <button className="btn btn-danger" onClick={confirmDelete}>
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Category Confirmation Modal */}
            {categoryToDelete && (
                <div className="modal-overlay" onClick={cancelDeleteCategory}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <h3>Delete Category</h3>
                        <p>Are you sure you want to delete this category? Books in this category will become uncategorized.</p>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={cancelDeleteCategory}>
                                Cancel
                            </button>
                            <button className="btn btn-danger" onClick={confirmDeleteCategory}>
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Book Modal */}
            {bookToEdit && (
                <div className="modal-overlay" onClick={cancelEdit}>
                    <div className="modal modal-edit" onClick={e => e.stopPropagation()}>
                        <h3>Edit Book Info</h3>
                        <div className="modal-form">
                            <div className="form-group">
                                <label htmlFor="edit-title">Title</label>
                                <input
                                    id="edit-title"
                                    type="text"
                                    value={bookToEdit.title}
                                    onChange={e => setBookToEdit({ ...bookToEdit, title: e.target.value })}
                                    onKeyDown={handleEditKeyDown}
                                    placeholder="Book title"
                                    autoFocus
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="edit-author">Author</label>
                                <input
                                    id="edit-author"
                                    type="text"
                                    value={bookToEdit.author}
                                    onChange={e => setBookToEdit({ ...bookToEdit, author: e.target.value })}
                                    onKeyDown={handleEditKeyDown}
                                    placeholder="Author name"
                                />
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={cancelEdit}>
                                Cancel
                            </button>
                            <button className="btn btn-primary" onClick={confirmEdit}>
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Category Modal */}
            {showCategoryModal && (
                <div className="modal-overlay" onClick={() => setShowCategoryModal(false)}>
                    <div className="modal modal-category" onClick={e => e.stopPropagation()}>
                        <h3>{editingCategory ? 'Edit Category' : 'New Category'}</h3>
                        <div className="modal-form">
                            <div className="form-group">
                                <label htmlFor="category-name">Name</label>
                                <input
                                    id="category-name"
                                    type="text"
                                    value={newCategoryName}
                                    onChange={e => setNewCategoryName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && confirmCategoryModal()}
                                    placeholder="Category name"
                                    autoFocus
                                />
                            </div>
                            <div className="form-group">
                                <label>Color</label>
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
                                Cancel
                            </button>
                            <button className="btn btn-primary" onClick={confirmCategoryModal} disabled={!newCategoryName.trim()}>
                                {editingCategory ? 'Save' : 'Create'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Assign Category Modal */}
            {bookForCategory && (
                <div className="modal-overlay" onClick={() => setBookForCategory(null)}>
                    <div className="modal modal-assign-category" onClick={e => e.stopPropagation()}>
                        <h3>Assign Category</h3>
                        <div className="category-assign-list">
                            <button
                                className="category-assign-item"
                                onClick={() => confirmBookCategory(undefined)}
                            >
                                <span className="category-color" style={{ backgroundColor: 'var(--text-muted)' }} />
                                <span>No Category</span>
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
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="sidebar-header">
                <h2 className="sidebar-title">
                    <BookIcon />
                    <span>Library</span>
                </h2>
                <div className="sidebar-header-actions">
                    <button className="btn btn-ghost btn-icon" onClick={handleAddCategory} title="Add category">
                        <FolderIcon />
                    </button>
                    <button className="btn btn-ghost btn-icon" onClick={onImportBook} title="Add book">
                        <PlusIcon />
                    </button>
                </div>
            </div>

            {/* Category Filter */}
            <div className="sidebar-categories">
                <button
                    className={`category-filter-item ${!selectedCategoryId || selectedCategoryId === 'all' ? 'active' : ''}`}
                    onClick={() => setSelectedCategoryId(null)}
                >
                    <span className="category-filter-name">All Books</span>
                    <span className="category-filter-count">{library.books.length}</span>
                </button>

                {groupedBooks.uncategorized.length > 0 && (
                    <button
                        className={`category-filter-item ${selectedCategoryId === 'uncategorized' ? 'active' : ''}`}
                        onClick={() => setSelectedCategoryId('uncategorized')}
                    >
                        <span className="category-filter-name">Uncategorized</span>
                        <span className="category-filter-count">{groupedBooks.uncategorized.length}</span>
                    </button>
                )}

                {categories.map(category => (
                    <div key={category.id} className="category-filter-group">
                        <div
                            role="button"
                            tabIndex={0}
                            className={`category-filter-item ${selectedCategoryId === category.id ? 'active' : ''}`}
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
                                    title="Edit category"
                                >
                                    <EditIcon />
                                </button>
                                <button
                                    className="btn btn-ghost btn-icon-sm"
                                    onClick={(e) => handleDeleteCategory(e, category.id)}
                                    title="Delete category"
                                >
                                    <TrashIcon />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="sidebar-content" ref={listContainerRef}>
                {filteredBooks.length === 0 ? (
                    <div className="sidebar-empty">
                        <div className="sidebar-empty-icon">
                            <BookIcon />
                        </div>
                        <h4>No books yet</h4>
                        <p>Import your first EPUB to get started</p>
                        <button className="btn btn-primary" onClick={onImportBook}>
                            <PlusIcon />
                            <span>Import EPUB</span>
                        </button>
                    </div>
                ) : (
                    <div className="book-list-virtual" style={{ height: totalHeight, position: 'relative' }}>
                        {virtualItems.map(({ book, style }) => (
                            <div
                                key={book.id}
                                className={`book-item ${currentBook?.id === book.id ? 'active' : ''}`}
                                style={style}
                                onClick={() => handleBookClick(book)}
                            >
                                <LazyBookCover book={book} coverUrls={coverUrls} />
                                <div className="book-info">
                                    <span className="book-title">{book.title}</span>
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
                                    {book.progress.percentage > 0 && (
                                        <div className="book-progress">
                                            <div
                                                className="book-progress-bar"
                                                style={{ width: `${book.progress.percentage}%` }}
                                            />
                                        </div>
                                    )}
                                </div>
                                <div className="book-actions">
                                    <button
                                        className="btn btn-ghost btn-icon book-action-btn"
                                        onClick={(e) => handleSetBookCategory(e, book.id)}
                                        title="Set category"
                                    >
                                        <TagIcon />
                                    </button>
                                    <button
                                        className="btn btn-ghost btn-icon book-edit"
                                        onClick={(e) => handleEditBook(e, book)}
                                        title="Edit book info"
                                    >
                                        <EditIcon />
                                    </button>
                                    <button
                                        className="btn btn-ghost btn-icon book-delete"
                                        onClick={(e) => handleDeleteBook(e, book.id)}
                                        title="Remove book"
                                    >
                                        <TrashIcon />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Book count footer */}
            <div className="sidebar-footer">
                <span className="book-count">
                    {filteredBooks.length} {filteredBooks.length === 1 ? 'book' : 'books'}
                    {selectedCategoryId && selectedCategoryId !== 'all' && ` in ${selectedCategoryId === 'uncategorized'
                        ? 'Uncategorized'
                        : categories.find(c => c.id === selectedCategoryId)?.name || ''
                        }`}
                </span>
            </div>
        </aside>
    );
}
