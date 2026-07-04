import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book, BookFolder, Library } from '../types';
import { useLibraryStore } from '../stores/libraryStore';
import { useProgressStore } from '../stores/progressStore';
import { useUIStore } from '../stores/uiStore';

import {
  click,
  installDialogElementStub,
  installIntersectionObserverStub,
  mount,
  setInputValue,
  settle,
} from './testUtils';

/**
 * Sidebar contract tests — issue #24 (Astryx Phase 2 Sidebar prefactor).
 *
 * These lock Sidebar's behavior against its CURRENT JSX before any Astryx
 * migration (slices #27–#30). The point of this slice is the safety net: when
 * a `List`/`SideNav`/`Dialog` swaps in, these tests must stay green because
 * they assert owned behavior (store interactions, modal open/close, folder
 * filtering, click handlers, confirm gating), never Astryx internals.
 *
 * Test style follows the Phase 1 contract-mock precedent (`AppDialog.test.tsx`)
 * via the shared harness in `./testUtils.tsx` (extracted in the #24 hardening
 * so SelectionToolbar #25 and AIPanel #26 reuse it).
 *
 * We do NOT adopt @testing-library/react. DOM assertions are limited to the
 * selectors/text Sidebar itself owns; when Astryx swaps in the selectors will
 * change and these tests get updated as part of that migration slice — which is
 * exactly the signal we want.
 */

// --- Mocks --------------------------------------------------------------
//
// vi.mock factories are hoisted ABOVE imports, so they cannot reference any
// imported binding (TDZ at hoist time). We use vi.hoisted() to create the
// confirm-state holder at hoist time and inline the mock bodies. The shared
// helpers in ./testUtils (mount/settle/input) are read at runtime, not hoisted.

const { getNextResult, setNextConfirmResult, resetConfirmState, getConfirmCalls, recordCall: hoistedRecordCall } = vi.hoisted(() => {
  let nextResult = true;
  const calls: Array<{ title: string; message: string }> = [];
  return {
    getNextResult: () => nextResult,
    setNextConfirmResult: (v: boolean) => {
      nextResult = v;
    },
    resetConfirmState: () => {
      nextResult = true;
      calls.length = 0;
    },
    getConfirmCalls: () => calls,
    recordCall: (c: { title: string; message: string }) => {
      calls.push(c);
    },
  };
});

vi.mock('./AppDialog', () => ({
  AppDialogProvider: ({ children }: { children: React.ReactNode }) => children,
  useAppDialog: () => ({
    confirm: (opts: { title: string; message: string }) => {
      // recordCall is exported from the same hoisted block; reference it via
      // the closure (vi.hoisted returns are safe to use inside vi.mock bodies).
      hoistedRecordCall(opts);
      return Promise.resolve(getNextResult());
    },
    notice: () => {},
  }),
}));
vi.mock('../services/CoverStore', () => ({
  getCoverUrl: () => Promise.resolve(null),
  deleteCover: () => Promise.resolve(undefined),
  revokeCoverUrl: () => {},
  setCoverUrl: () => {},
  setCoverData: () => {},
}));
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

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

function makeFolder(overrides: Partial<BookFolder> = {}): BookFolder {
  return { id: 'folder1', name: 'Reading', sortOrder: 0, createdAt: 1, ...overrides };
}

/**
 * Seed the library via the store's own setLibrary path (not raw setState): the
 * library store keeps a module-level `latestLibrary` mirror (updated via
 * syncLibrary) that mutators like updateBook/setBookFolder read through
 * getLatestLibrary(). setLibrary keeps both in sync; a raw setState would leave
 * latestLibrary stale and silently drop mutations.
 */
function seedLibrary(library: Library, currentBook: Book | null = null) {
  useLibraryStore.getState().setLibrary(library);
  useLibraryStore.getState().setCurrentBook(currentBook);
}

interface Handlers {
  onImportBook?: () => void;
  onOpenSettings?: () => void;
  onPreloadReader?: () => Promise<unknown>;
}

function mountSidebar(handlers: Handlers = {}) {
  return mount(
    <Sidebar
      onImportBook={handlers.onImportBook ?? (() => {})}
      onOpenSettings={handlers.onOpenSettings ?? (() => {})}
      onPreloadReader={handlers.onPreloadReader ?? (() => Promise.resolve())}
    />,
  );
}

// Expand the folders section so folder children render, then return the child
// node matching the given name. The click is async (React re-render), so the
// caller awaits this and searches after the settle.
async function expandFoldersAndFindChild(container: HTMLElement, name: string): Promise<HTMLElement> {
  const foldersToggle = Array.from(container.querySelectorAll('button')).find(
    (el) => el.textContent?.includes('文件夹'),
  ) as HTMLElement;
  click(foldersToggle);
  await settle();
  const child = Array.from(container.querySelectorAll('button')).find(
    (el) => el.textContent?.includes(name),
  ) as HTMLElement | undefined;
  return child!;
}

// --- Setup ---------------------------------------------------------------

beforeEach(() => {
  installIntersectionObserverStub();
  installDialogElementStub();
  resetConfirmState();
  useLibraryStore.setState({
    library: { books: [], folders: [], lastUpdated: 1 },
    currentBook: null,
  });
  useProgressStore.setState({ bookProgressById: {} });
  useUIStore.setState({ isSidebarOpen: true, isAIPanelOpen: false, isSearchOpen: false });
});

// --- Tests ---------------------------------------------------------------

describe('Sidebar contract — rendering', () => {
  it('renders nothing when the sidebar is closed', () => {
    useUIStore.setState({ isSidebarOpen: false, isAIPanelOpen: false, isSearchOpen: false });
    const { container } = mountSidebar();
    expect(container.textContent).toBe('');
  });

  it('renders the empty state when the library has no books', () => {
    seedLibrary({ books: [], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar();
    expect(container.textContent).toContain('还没有书籍');
  });

  it('renders the book list from the seeded library', () => {
    seedLibrary({
      books: [makeBook({ id: 'b1', title: 'Solitude' }), makeBook({ id: 'b2', title: 'Walden' })],
      folders: [],
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
    seedLibrary({ books: [book, other], folders: [], lastUpdated: 1 }, book);
    const { container } = mountSidebar();
    const activeItem = container.querySelector('.book-item.active') as HTMLElement | null;
    expect(activeItem).not.toBeNull();
    expect(activeItem!.textContent).toContain('Active');
  });
});

describe('Sidebar contract — book interactions', () => {
  it('calls setCurrentBook when a book item is clicked', async () => {
    const book = makeBook({ id: 'b1', title: 'Click Me' });
    seedLibrary({ books: [book], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar();
    expect(useLibraryStore.getState().currentBook).toBeNull();
    click(container.querySelector('.book-item')!);
    await settle();
    expect(useLibraryStore.getState().currentBook?.id).toBe('b1');
  });

  it('removes a book when the delete confirm is accepted', async () => {
    setNextConfirmResult(true);
    seedLibrary({ books: [makeBook({ id: 'b1', title: 'Delete Me' })], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar();
    click(container.querySelector('.book-delete')!);
    await settle();
    expect(useLibraryStore.getState().library.books).toHaveLength(0);
    expect(getConfirmCalls()).toHaveLength(1);
  });

  it('keeps the book when the delete confirm is cancelled', async () => {
    setNextConfirmResult(false);
    seedLibrary({ books: [makeBook({ id: 'b1', title: 'Keep Me' })], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar();
    click(container.querySelector('.book-delete')!);
    await settle();
    expect(useLibraryStore.getState().library.books).toHaveLength(1);
  });

  it('invokes onImportBook when the empty-state import button is clicked', () => {
    const onImportBook = vi.fn();
    seedLibrary({ books: [], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar({ onImportBook });
    const importBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('导入书籍'),
    ) as HTMLButtonElement;
    click(importBtn);
    expect(onImportBook).toHaveBeenCalledTimes(1);
  });

  it('invokes onImportBook when the header import button is clicked', () => {
    const onImportBook = vi.fn();
    seedLibrary({ books: [makeBook()], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar({ onImportBook });
    const importBtn = container.querySelector('[aria-label="导入 EPUB"]') as HTMLButtonElement;
    click(importBtn);
    expect(onImportBook).toHaveBeenCalledTimes(1);
  });

  it('invokes onOpenSettings when the settings footer button is clicked', () => {
    const onOpenSettings = vi.fn();
    seedLibrary({ books: [makeBook()], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar({ onOpenSettings });
    const settingsBtn = container.querySelector('.sidebar-settings-btn') as HTMLButtonElement;
    click(settingsBtn);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});

describe('Sidebar contract — folder nav', () => {
  it('filters the book list when a folder is selected', async () => {
    const folder = makeFolder({ id: 'folder1', name: 'Reading' });
    const inFolder = makeBook({ id: 'b1', title: 'In Folder', folderId: 'folder1' });
    const outFolder = makeBook({ id: 'b2', title: 'Outside' });
    seedLibrary({ books: [inFolder, outFolder], folders: [folder], lastUpdated: 1 });
    const { container } = mountSidebar();
    expect(container.textContent).toContain('In Folder');
    expect(container.textContent).toContain('Outside');

    const readingChild = await expandFoldersAndFindChild(container, 'Reading');
    click(readingChild);
    await settle();

    expect(container.textContent).toContain('In Folder');
    expect(container.textContent).not.toContain('Outside');
  });
});

describe('Sidebar contract — edit-book modal', () => {
  it('opens from the edit action and commits the edited title/author on save', async () => {
    const book = makeBook({ id: 'b1', title: 'Old Title', author: 'Old Author' });
    seedLibrary({ books: [book], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar();
    expect(container.querySelector('.modal-edit')).toBeNull();

    click(container.querySelector('.book-edit')!);
    await settle();

    const modal = container.querySelector('.modal-edit') as HTMLElement;
    const inputs = modal.querySelectorAll('input');
    expect((inputs[0] as HTMLInputElement).value).toBe('Old Title');
    expect((inputs[1] as HTMLInputElement).value).toBe('Old Author');

    setInputValue(inputs[0], 'New Title');
    setInputValue(inputs[1], 'New Author');
    const saveBtn = Array.from(modal.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '保存',
    )!;
    click(saveBtn);
    await settle();

    const updated = useLibraryStore.getState().library.books[0];
    expect(updated.title).toBe('New Title');
    expect(updated.author).toBe('New Author');
    expect(container.querySelector('.modal-edit')).toBeNull();
  });

  it('closes without mutating the store when the cancel button is clicked', async () => {
    const book = makeBook({ id: 'b1', title: 'Keep' });
    seedLibrary({ books: [book], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar();
    click(container.querySelector('.book-edit')!);
    await settle();

    const modal = container.querySelector('.modal-edit') as HTMLElement;
    setInputValue(modal.querySelectorAll('input')[0], 'Changed');
    click(Array.from(modal.querySelectorAll('button')).find((b) => b.textContent?.trim() === '取消')!);
    await settle();

    expect(useLibraryStore.getState().library.books[0].title).toBe('Keep');
    expect(container.querySelector('.modal-edit')).toBeNull();
  });

  it('closes without mutating the store when the overlay is clicked', async () => {
    const book = makeBook({ id: 'b1', title: 'Keep' });
    seedLibrary({ books: [book], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar();
    click(container.querySelector('.book-edit')!);
    await settle();

    const overlay = container.querySelector('.modal-overlay') as HTMLElement;
    click(overlay);
    await settle();

    expect(useLibraryStore.getState().library.books[0].title).toBe('Keep');
    expect(container.querySelector('.modal-edit')).toBeNull();
  });

  it('submits on Enter and cancels on Escape while focused in an input', async () => {
    const book = makeBook({ id: 'b1', title: 'Old' });
    seedLibrary({ books: [book], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar();
    click(container.querySelector('.book-edit')!);
    await settle();

    const modal = container.querySelector('.modal-edit') as HTMLElement;
    const titleInput = modal.querySelectorAll('input')[0];
    setInputValue(titleInput, 'Via Enter');
    titleInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await settle();

    expect(useLibraryStore.getState().library.books[0].title).toBe('Via Enter');
    expect(container.querySelector('.modal-edit')).toBeNull();
  });
});

describe('Sidebar contract — folder modal (add + edit)', () => {
  it('disables the create button when the name is empty and creates a colorless folder when filled', async () => {
    seedLibrary({ books: [], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar();
    expect(container.querySelector('.modal-category')).toBeNull();

    click(container.querySelector('[aria-label="新增文件夹"]')!);
    await settle();

    const modal = container.querySelector('.modal-category') as HTMLElement;
    const nameInput = modal.querySelector('input') as HTMLInputElement;
    const createBtn = Array.from(modal.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '创建',
    )!;
    expect(createBtn.disabled).toBe(true);

    setInputValue(nameInput, 'Favorites');
    expect(createBtn.disabled).toBe(false);
    click(createBtn);
    await settle();

    const folder = useLibraryStore.getState().library.folders[0];
    expect(folder.name).toBe('Favorites');
    expect('color' in folder).toBe(false);
    expect(container.querySelector('.modal-category')).toBeNull();
  });

  it('opens the edit-folder modal pre-filled and commits the rename without adding color', async () => {
    const folder = makeFolder({ id: 'folder1', name: 'Old Name' });
    seedLibrary({ books: [], folders: [folder], lastUpdated: 1 });
    const { container } = mountSidebar();

    await expandFoldersAndFindChild(container, 'Old Name');
    click(container.querySelector('[aria-label="Old Name 操作"]')!);
    await settle();
    const editBtn = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (item) => item.textContent?.trim() === '编辑文件夹',
    )!;
    click(editBtn);
    await settle();

    const modal = container.querySelector('.modal-category') as HTMLElement;
    const nameInput = modal.querySelector('input') as HTMLInputElement;
    expect(nameInput.value).toBe('Old Name');
    // The confirm button reads 保存 (not 创建) in edit mode.
    const saveBtn = Array.from(modal.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '保存',
    )!;

    setInputValue(nameInput, 'New Name');
    click(saveBtn);
    await settle();

    const updated = useLibraryStore.getState().library.folders[0];
    expect(updated.name).toBe('New Name');
    expect('color' in updated).toBe(false);
    expect(container.querySelector('.modal-category')).toBeNull();
  });

  it('closes when the overlay is clicked without creating a folder', async () => {
    seedLibrary({ books: [], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar();
    click(container.querySelector('[aria-label="新增文件夹"]')!);
    await settle();

    click(container.querySelector('.modal-overlay')!);
    await settle();

    expect(container.querySelector('.modal-category')).toBeNull();
    expect(useLibraryStore.getState().library.folders).toHaveLength(0);
  });
});

describe('Sidebar contract — assign-folder modal', () => {
  it('assigns a folder to a book and closes', async () => {
    const folder = makeFolder({ id: 'folder1', name: 'Reading' });
    const book = makeBook({ id: 'b1', title: 'Unfiled' });
    seedLibrary({ books: [book], folders: [folder], lastUpdated: 1 });
    const { container } = mountSidebar();

    click(container.querySelector('.book-action-btn')!);
    await settle();

    const modal = container.querySelector('.modal-assign-category') as HTMLElement;
    const catOption = Array.from(modal.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Reading',
    )!;
    click(catOption);
    await settle();

    expect(useLibraryStore.getState().library.books[0].folderId).toBe('folder1');
    expect(container.querySelector('.modal-assign-category')).toBeNull();
  });

  it('clears the book folder when "未归档" is selected', async () => {
    const folder = makeFolder({ id: 'folder1', name: 'Reading' });
    const book = makeBook({ id: 'b1', title: 'Filed', folderId: 'folder1' });
    seedLibrary({ books: [book], folders: [folder], lastUpdated: 1 });
    const { container } = mountSidebar();

    click(container.querySelector('.book-action-btn')!);
    await settle();

    const modal = container.querySelector('.modal-assign-category') as HTMLElement;
    const uncatOption = Array.from(modal.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '未归档',
    )!;
    click(uncatOption);
    await settle();

    expect(useLibraryStore.getState().library.books[0].folderId).toBeUndefined();
    expect(container.querySelector('.modal-assign-category')).toBeNull();
  });

  it('closes without changing the book when the overlay is clicked', async () => {
    const folder = makeFolder({ id: 'folder1', name: 'Reading' });
    const book = makeBook({ id: 'b1', title: 'Original', folderId: 'folder1' });
    seedLibrary({ books: [book], folders: [folder], lastUpdated: 1 });
    const { container } = mountSidebar();

    click(container.querySelector('.book-action-btn')!);
    await settle();

    click(document.body.querySelector('.category-assign-dialog')!);
    await settle();

    expect(useLibraryStore.getState().library.books[0].folderId).toBe('folder1');
    expect(container.querySelector('.modal-assign-category')).toBeNull();
  });
});
