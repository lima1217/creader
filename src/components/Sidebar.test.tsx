import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book, BookCategory, Library } from '../types';
import { useLibraryStore } from '../stores/libraryStore';
import { useProgressStore } from '../stores/progressStore';
import { useUIStore } from '../stores/uiStore';

/**
 * Sidebar contract tests — issue #24 (Astryx Phase 2 Sidebar prefactor).
 *
 * These lock Sidebar's behavior against its CURRENT JSX before any Astryx
 * migration (slices #27–#30). The point of this slice is the safety net: when
 * a `List`/`SideNav`/`Dialog` swaps in, these tests must stay green because
 * they assert owned behavior (store interactions, modal open/close, category
 * filtering, click handlers, confirm gating), never Astryx internals.
 *
 * Test style follows the Phase 1 contract-mock precedent (`AppDialog.test.tsx`):
 * - mock the dialog/async deps so the surface is deterministic,
 * - drive stores via direct `setState` (the `uiStore.test.ts` pattern),
 * - assert on Sidebar-owned DOM text + the resulting store mutations.
 *
 * We do NOT adopt @testing-library/react. DOM assertions are limited to the
 * selectors/text Sidebar itself owns; when Astryx swaps in the selectors will
 * change and these tests get updated as part of that migration slice — which is
 * exactly the signal we want.
 */

// --- Mocks --------------------------------------------------------------

// Confirm/notice calls captured here so tests can assert the dialog flow
// without depending on Astryx's AlertDialog/Toast portal internals.
const confirmCalls: Array<{ title: string; message: string }> = [];
// What the next confirm() resolves to. Tests set this before triggering an
// action that calls confirm() (delete book / delete category).
let nextConfirmResult = true;

// Mock the AppDialog module: provider is a passthrough, useAppDialog returns
// controllable confirm/notice. This keeps the real Sidebar → useAppDialog()
// wiring intact while removing the Astryx portal dependency.
vi.mock('./AppDialog', () => ({
  AppDialogProvider: ({ children }: { children: React.ReactNode }) => children,
  useAppDialog: () => ({
    confirm: (opts: { title: string; message: string }) => {
      confirmCalls.push(opts);
      return Promise.resolve(nextConfirmResult);
    },
    notice: () => {},
  }),
}));

// CoverStore touches IndexedDB and is invoked by the library store's
// removeBook (deleteCover/revokeCoverUrl) and by LazyBookCover (getCoverUrl).
// Keep the real module shape but neuter the async side effects so the chrome
// contracts stay deterministic.
vi.mock('../services/CoverStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/CoverStore')>();
  return {
    ...actual,
    getCoverUrl: vi.fn().mockResolvedValue(null),
    deleteCover: vi.fn().mockResolvedValue(undefined),
    revokeCoverUrl: vi.fn(),
  };
});

// The library store logs a warning when the (non-Tauri) book-file delete
// fails — that's an environment artifact in jsdom, not a Sidebar contract.
// Silence the logger so test output stays clean without hiding real failures.
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

// Imported AFTER mock declarations so they pick up the mocks.
import { Sidebar } from './Sidebar';

// --- Fixtures ------------------------------------------------------------

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'b1',
    title: 'A Book',
    author: 'An Author',
    filePath: '/tmp/book.epub',
    addedAt: 1,
    lastReadAt: 0,
    progress: { currentCfi: '', percentage: 0 },
    ...overrides,
  };
}

function makeCategory(overrides: Partial<BookCategory> = {}): BookCategory {
  return { id: 'cat1', name: 'Reading', color: '#ff0000', createdAt: 1, ...overrides };
}

function seedLibrary(library: Library, currentBook: Book | null = null) {
  // Use the store's own setLibrary path rather than setState: the library
  // store keeps a module-level `latestLibrary` mirror (updated via syncLibrary)
  // that mutators like updateBook/setBookCategory read through
  // getLatestLibrary(). setLibrary keeps both in sync; a raw setState would
  // leave latestLibrary stale and silently drop mutations.
  useLibraryStore.getState().setLibrary(library);
  useLibraryStore.getState().setCurrentBook(currentBook);
}

// --- Harness -------------------------------------------------------------

function mountSidebar(handlers: {
  onImportBook?: () => void;
  onOpenSettings?: () => void;
  onPreloadReader?: () => Promise<unknown>;
} = {}): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  flushSync(() => {
    root.render(
      <Sidebar
        onImportBook={handlers.onImportBook ?? (() => {})}
        onOpenSettings={handlers.onOpenSettings ?? (() => {})}
        onPreloadReader={handlers.onPreloadReader ?? (() => Promise.resolve())}
      />,
    );
  });
  return { container, root };
}

async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  flushSync(() => {});
}

// Set a value on a React-controlled input so onChange fires (React 18 reads
// from the native value setter, not the property, for controlled inputs).
function setInputValue(element: Element, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

// --- Setup / cleanup -----------------------------------------------------

const roots: Root[] = [];

beforeEach(() => {
  // jsdom does not provide IntersectionObserver; LazyBookCover uses it only
  // to lazy-load covers (an IndexedDB concern, mocked above). The stub makes
  // elements immediately "visible" so the cover path resolves; it does not
  // affect any Sidebar chrome contract under test.
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
  confirmCalls.length = 0;
  nextConfirmResult = true;
  useLibraryStore.setState({
    library: { books: [], categories: [], lastUpdated: 1 },
    currentBook: null,
  });
  useProgressStore.setState({ bookProgressById: {} });
  useUIStore.setState({ isSidebarOpen: true, isAIPanelOpen: false, isSearchOpen: false });
});

afterEach(() => {
  while (roots.length) {
    const r = roots.pop()!;
    try {
      flushSync(() => r.unmount());
    } catch {
      /* ignore */
    }
  }
  document.body.innerHTML = '';
});

// --- Tests ---------------------------------------------------------------

describe('Sidebar contract', () => {
  it('renders nothing when the sidebar is closed', () => {
    useUIStore.setState({ isSidebarOpen: false, isAIPanelOpen: false, isSearchOpen: false });
    const { container } = mountSidebar();
    expect(container.textContent).toBe('');
  });

  it('renders the empty state when the library has no books', () => {
    seedLibrary({ books: [], categories: [], lastUpdated: 1 });
    const { container } = mountSidebar();
    expect(container.textContent).toContain('还没有书籍');
  });

  it('renders the book list from the seeded library', () => {
    seedLibrary({
      books: [makeBook({ id: 'b1', title: 'Solitude' }), makeBook({ id: 'b2', title: 'Walden' })],
      categories: [],
      lastUpdated: 1,
    });
    const { container } = mountSidebar();
    const text = container.textContent ?? '';
    expect(text).toContain('Solitude');
    expect(text).toContain('Walden');
  });

  it('marks the current book as active in the list', () => {
    const book = makeBook({ id: 'b1', title: 'Active' });
    const other = makeBook({ id: 'b2', title: 'Other' });
    seedLibrary({ books: [book, other], categories: [], lastUpdated: 1 }, book);
    const { container } = mountSidebar();

    const activeItem = container.querySelector('.book-item.active') as HTMLElement | null;
    expect(activeItem).not.toBeNull();
    expect(activeItem!.textContent).toContain('Active');
  });

  it('calls setCurrentBook when a book item is clicked', async () => {
    const book = makeBook({ id: 'b1', title: 'Click Me' });
    seedLibrary({ books: [book], categories: [], lastUpdated: 1 });
    const { container } = mountSidebar();

    expect(useLibraryStore.getState().currentBook).toBeNull();

    const bookItem = container.querySelector('.book-item') as HTMLElement;
    bookItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    expect(useLibraryStore.getState().currentBook?.id).toBe('b1');
  });

  it('filters the book list when a category is selected', async () => {
    const cat = makeCategory({ id: 'cat1', name: 'Reading' });
    const inCat = makeBook({ id: 'b1', title: 'In Category', categoryId: 'cat1' });
    const outCat = makeBook({ id: 'b2', title: 'Outside' });
    seedLibrary({ books: [inCat, outCat], categories: [cat], lastUpdated: 1 });
    const { container } = mountSidebar();

    // Both render with no filter selected.
    expect(container.textContent).toContain('In Category');
    expect(container.textContent).toContain('Outside');

    // The category nav is collapsed under the "标签" toggle; expand it first,
    // then click the category child item whose name matches.
    const tagsToggle = Array.from(container.querySelectorAll('[role="button"]')).find(
      (el) => el.querySelector('.category-filter-name')?.textContent === '标签',
    ) as HTMLElement;
    tagsToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    // Category child items render inside .category-children. The child's name
    // span disambiguates from the nested edit/delete action labels.
    const readingChild = Array.from(
      container.querySelectorAll('.category-child-item .category-filter-name'),
    ).find((el) => el.textContent === 'Reading') as HTMLElement | undefined;
    expect(readingChild, 'category child should render after expanding tags').toBeDefined();
    readingChild!.closest('.category-child-item')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await settle();

    expect(container.textContent).toContain('In Category');
    expect(container.textContent).not.toContain('Outside');
  });

  it('opens the edit-book modal and commits the edited title/author on save', async () => {
    const book = makeBook({ id: 'b1', title: 'Old Title', author: 'Old Author' });
    seedLibrary({ books: [book], categories: [], lastUpdated: 1 });
    const { container } = mountSidebar();

    expect(container.querySelector('.modal-edit')).toBeNull();

    const editBtn = container.querySelector('.book-edit') as HTMLButtonElement;
    editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    const modal = container.querySelector('.modal-edit') as HTMLElement;
    expect(modal).not.toBeNull();
    const inputs = modal.querySelectorAll('input');
    expect((inputs[0] as HTMLInputElement).value).toBe('Old Title');
    expect((inputs[1] as HTMLInputElement).value).toBe('Old Author');

    setInputValue(inputs[0], 'New Title');
    setInputValue(inputs[1], 'New Author');

    const saveBtn = Array.from(modal.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '保存',
    ) as HTMLButtonElement;
    saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    const updated = useLibraryStore.getState().library.books[0];
    expect(updated.title).toBe('New Title');
    expect(updated.author).toBe('New Author');
    expect(container.querySelector('.modal-edit')).toBeNull();
  });

  it('cancels the edit-book modal without mutating the store', async () => {
    const book = makeBook({ id: 'b1', title: 'Keep' });
    seedLibrary({ books: [book], categories: [], lastUpdated: 1 });
    const { container } = mountSidebar();

    (container.querySelector('.book-edit') as HTMLButtonElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await settle();

    const modal = container.querySelector('.modal-edit') as HTMLElement;
    setInputValue(modal.querySelectorAll('input')[0], 'Changed');
    const cancelBtn = Array.from(modal.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '取消',
    ) as HTMLButtonElement;
    cancelBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    expect(useLibraryStore.getState().library.books[0].title).toBe('Keep');
    expect(container.querySelector('.modal-edit')).toBeNull();
  });

  it('disables the category create button when the name is empty and creates when filled', async () => {
    seedLibrary({ books: [], categories: [], lastUpdated: 1 });
    const { container } = mountSidebar();

    expect(container.querySelector('.modal-category')).toBeNull();

    const addCatBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('title') === '新增标签',
    ) as HTMLButtonElement;
    addCatBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    const modal = container.querySelector('.modal-category') as HTMLElement;
    expect(modal).not.toBeNull();
    const nameInput = modal.querySelector('#category-name') as HTMLInputElement;
    const createBtn = Array.from(modal.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '创建',
    ) as HTMLButtonElement;

    expect(createBtn.disabled).toBe(true);

    setInputValue(nameInput, 'Favorites');
    expect(createBtn.disabled).toBe(false);
    createBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    const cats = useLibraryStore.getState().library.categories;
    expect(cats).toHaveLength(1);
    expect(cats[0].name).toBe('Favorites');
    expect(container.querySelector('.modal-category')).toBeNull();
  });

  it('assigns a category to a book via the assign-category modal', async () => {
    const cat = makeCategory({ id: 'cat1', name: 'Reading' });
    const book = makeBook({ id: 'b1', title: 'Uncategorized' });
    seedLibrary({ books: [book], categories: [cat], lastUpdated: 1 });
    const { container } = mountSidebar();

    (container.querySelector('.book-action-btn') as HTMLButtonElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await settle();

    const modal = container.querySelector('.modal-assign-category') as HTMLElement;
    expect(modal).not.toBeNull();

    const catOption = Array.from(modal.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Reading',
    ) as HTMLButtonElement;
    catOption.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    expect(useLibraryStore.getState().library.books[0].categoryId).toBe('cat1');
    expect(container.querySelector('.modal-assign-category')).toBeNull();
  });

  it('removes a book when the delete confirm is accepted', async () => {
    nextConfirmResult = true;
    seedLibrary({ books: [makeBook({ id: 'b1', title: 'Delete Me' })], categories: [], lastUpdated: 1 });
    const { container } = mountSidebar();

    (container.querySelector('.book-delete') as HTMLButtonElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await settle();

    expect(useLibraryStore.getState().library.books).toHaveLength(0);
    expect(confirmCalls).toHaveLength(1);
  });

  it('keeps the book when the delete confirm is cancelled', async () => {
    nextConfirmResult = false;
    seedLibrary({ books: [makeBook({ id: 'b1', title: 'Keep Me' })], categories: [], lastUpdated: 1 });
    const { container } = mountSidebar();

    (container.querySelector('.book-delete') as HTMLButtonElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await settle();

    expect(useLibraryStore.getState().library.books).toHaveLength(1);
  });
});
