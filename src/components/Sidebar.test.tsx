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
 * Sidebar contract tests — Library Organizer behavior closure.
 *
 * These lock owned behavior (store interactions, modal open/close, folder
 * filtering, drag/drop, click handlers, confirm gating), never Astryx internals.
 *
 * Test style follows the Phase 1 contract-mock precedent (`AppDialog.test.tsx`)
 * via the shared harness in `./testUtils.tsx` (extracted in the #24 hardening
 * so SelectionToolbar #25 and AIPanel #26 reuse it).
 *
 * We do NOT adopt @testing-library/react. DOM assertions are limited to the
 * selectors/text Sidebar itself owns.
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
 * syncLibrary) that mutators like setBookFolder read through
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

async function findOrganizerButton(container: HTMLElement, name: string): Promise<HTMLElement> {
  const child = Array.from(container.querySelectorAll('button')).find(
    (el) => el.textContent?.includes(name),
  ) as HTMLElement | undefined;
  return child!;
}

/** User-created folders live in `.folder-nav-group-nested`, not the unfiled section. */
function findUserFolderGroup(container: HTMLElement, folderName?: string): HTMLElement {
  const groups = container.querySelectorAll('.folder-nav-group-nested');
  if (!folderName) return groups[0] as HTMLElement;
  const match = Array.from(groups).find((group) => group.textContent?.includes(folderName));
  return match as HTMLElement;
}

function userFolderGroups(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('.folder-nav-group-nested'));
}

/**
 * Locate a button inside the sidebar actions block by its visible label.
 * The actions buttons (导入书籍 / 新文件夹) render their `label` as visible
 * text rather than aria-label, so we match on trimmed text content scoped to
 * `.sidebar-actions` to avoid colliding with Same-named organizer entries.
 */
function findSidebarActionButton(container: HTMLElement, label: string): HTMLButtonElement {
  const actions = container.querySelector('.sidebar-actions');
  const btn = Array.from(actions!.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
  return btn!;
}

function makeDataTransfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: 'all',
    dropEffect: 'none',
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) || '',
  };
}

function dispatchDragEvent(element: Element, type: string, dataTransfer = makeDataTransfer()) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  element.dispatchEvent(event);
  return { event, dataTransfer };
}

async function clickBookAction(container: HTMLElement, bookTitle: string, actionLabel: string) {
  const bookItem = Array.from(container.querySelectorAll('.book-item')).find(
    (item) => item.textContent?.includes(bookTitle),
  ) as HTMLElement;
  click(bookItem.querySelector('.book-actions button')!);
  await settle();
  const item = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
    (menuItem) => menuItem.textContent?.trim() === actionLabel,
  )!;
  click(item);
  await settle();
}

// --- Setup ---------------------------------------------------------------

beforeEach(() => {
  installIntersectionObserverStub();
  installDialogElementStub();
  localStorage.removeItem('creader-library-organizer-expanded-folders');
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

  it('opens the per-book more menu without rendering a tooltip layer', async () => {
    seedLibrary({ books: [makeBook({ id: 'b1', title: 'Quiet Book' })], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar();
    const button = container.querySelector('.book-actions button') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button!.getAttribute('aria-describedby')).toBeNull();

    click(button!);
    await settle();

    expect(Array.from(document.body.querySelectorAll('[role="menuitem"]')).map(item => item.textContent?.trim())).toEqual([
      '移动到文件夹',
      '编辑书籍信息',
      '移除书籍',
    ]);
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    expect(useLibraryStore.getState().currentBook).toBeNull();
  });

  it('opens the edit-book modal from the per-book menu and saves changes', async () => {
    seedLibrary({ books: [makeBook({ id: 'b1', title: 'Draft', author: 'Anon' })], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar();

    await clickBookAction(container, 'Draft', '编辑书籍信息');

    const modal = container.querySelector('.modal-edit') as HTMLElement;
    const [titleInput, authorInput] = Array.from(modal.querySelectorAll('input')) as HTMLInputElement[];
    setInputValue(titleInput, 'Published');
    setInputValue(authorInput, 'Reader');
    click(Array.from(modal.querySelectorAll('button')).find(button => button.textContent?.trim() === '保存')!);
    await settle();

    expect(useLibraryStore.getState().library.books[0]).toMatchObject({
      title: 'Published',
      author: 'Reader',
    });
    expect(container.querySelector('.modal-edit')).toBeNull();
  });

  it('removes a book when the delete confirm is accepted', async () => {
    setNextConfirmResult(true);
    seedLibrary({ books: [makeBook({ id: 'b1', title: 'Delete Me' })], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar();

    await clickBookAction(container, 'Delete Me', '移除书籍');

    expect(useLibraryStore.getState().library.books).toHaveLength(0);
    expect(getConfirmCalls()).toHaveLength(1);
  });

  it('keeps the book when the delete confirm is cancelled', async () => {
    setNextConfirmResult(false);
    seedLibrary({ books: [makeBook({ id: 'b1', title: 'Keep Me' })], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar();

    await clickBookAction(container, 'Keep Me', '移除书籍');

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
    const importBtn = findSidebarActionButton(container, '导入书籍');
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
  it('expands a folder inline without hiding unfiled books', async () => {
    const folder = makeFolder({ id: 'folder1', name: 'Reading' });
    const inFolder = makeBook({ id: 'b1', title: 'In Folder', folderId: 'folder1' });
    const outFolder = makeBook({ id: 'b2', title: 'Outside' });
    localStorage.setItem('creader-library-organizer-expanded-folders', JSON.stringify([]));
    seedLibrary({ books: [inFolder, outFolder], folders: [folder], lastUpdated: 1 });
    const { container } = mountSidebar();
    expect(Array.from(container.querySelectorAll('.book-item')).map(el => el.textContent).join(' ')).not.toContain('In Folder');
    expect(Array.from(container.querySelectorAll('.book-item')).map(el => el.textContent).join(' ')).toContain('Outside');

    const readingChild = await findOrganizerButton(container, 'Reading');
    click(readingChild);
    await settle();

    const visibleBooks = Array.from(container.querySelectorAll('.book-item')).map(el => el.textContent).join(' ');
    expect(visibleBooks).toContain('In Folder');
    expect(visibleBooks).toContain('Outside');
  });

  it('does not render an all-books organizer button', () => {
    seedLibrary({ books: [makeBook()], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar();
    expect(container.textContent).not.toContain('全部书籍');
  });

  it('remembers multiple expanded folders as UI state', async () => {
    const folderA = makeFolder({ id: 'folder-a', name: 'Theory', sortOrder: 0 });
    const folderB = makeFolder({ id: 'folder-b', name: 'Practice', sortOrder: 1 });
    const theoryBook = makeBook({ id: 'b1', title: 'Deep Work', folderId: 'folder-a' });
    const practiceBook = makeBook({ id: 'b2', title: 'Ship It', folderId: 'folder-b' });
    localStorage.setItem('creader-library-organizer-expanded-folders', JSON.stringify(['folder-b']));
    seedLibrary({ books: [theoryBook, practiceBook], folders: [folderA, folderB], lastUpdated: 1 });

    const { container } = mountSidebar();
    await settle();
    expect(Array.from(container.querySelectorAll('.book-item')).map(el => el.textContent).join(' ')).not.toContain('Deep Work');
    expect(Array.from(container.querySelectorAll('.book-item')).map(el => el.textContent).join(' ')).toContain('Ship It');

    click(await findOrganizerButton(container, 'Theory'));
    await settle();
    expect(JSON.parse(localStorage.getItem('creader-library-organizer-expanded-folders') || '[]').sort()).toEqual(['folder-a', 'folder-b']);
  });

  it('expands the current book folder on first entry when remembered state is empty', async () => {
    const folder = makeFolder({ id: 'folder1', name: 'Reading' });
    const current = makeBook({ id: 'b1', title: 'Current Folder Book', folderId: 'folder1' });
    localStorage.setItem('creader-library-organizer-expanded-folders', JSON.stringify([]));
    seedLibrary({ books: [current], folders: [folder], lastUpdated: 1 }, current);

    const { container } = mountSidebar();
    await settle();

    expect(container.querySelector('.book-item')?.textContent).toContain('Current Folder Book');
    expect(JSON.parse(localStorage.getItem('creader-library-organizer-expanded-folders') || '[]')).toEqual(['folder1']);
  });

  it('expands only the current book folder on first load when no persisted expansion exists', async () => {
    const folderA = makeFolder({ id: 'folder-a', name: 'Theory', sortOrder: 0 });
    const folderB = makeFolder({ id: 'folder-b', name: 'Practice', sortOrder: 1 });
    const current = makeBook({ id: 'b1', title: 'Current Folder Book', folderId: 'folder-b' });
    const other = makeBook({ id: 'b2', title: 'Other Book', folderId: 'folder-a' });
    localStorage.removeItem('creader-library-organizer-expanded-folders');
    seedLibrary({ books: [current, other], folders: [folderA, folderB], lastUpdated: 1 }, current);

    const { container } = mountSidebar();
    await settle();

    expect(JSON.parse(localStorage.getItem('creader-library-organizer-expanded-folders') || '[]')).toEqual(['folder-b']);
    expect(Array.from(container.querySelectorAll('.book-item')).map(el => el.textContent).join(' ')).toContain('Current Folder Book');
    expect(Array.from(container.querySelectorAll('.book-item')).map(el => el.textContent).join(' ')).not.toContain('Other Book');
  });

  it('removes deleted folder ids from remembered expansion state', async () => {
    localStorage.setItem('creader-library-organizer-expanded-folders', JSON.stringify(['deleted-folder']));
    seedLibrary({ books: [], folders: [], lastUpdated: 1 });

    mountSidebar();
    await settle();

    expect(JSON.parse(localStorage.getItem('creader-library-organizer-expanded-folders') || '[]')).toEqual([]);
  });

  it('moves a dragged book into a real folder', async () => {
    const folder = makeFolder({ id: 'folder1', name: 'Reading' });
    const book = makeBook({ id: 'b1', title: 'Unfiled' });
    seedLibrary({ books: [book], folders: [folder], lastUpdated: 1 });
    const { container } = mountSidebar();
    await settle();

    const { dataTransfer } = dispatchDragEvent(container.querySelector('.book-item')!, 'dragstart');
    const folderTarget = findUserFolderGroup(container, 'Reading');
    dispatchDragEvent(folderTarget, 'dragover', dataTransfer);
    dispatchDragEvent(folderTarget, 'drop', dataTransfer);
    await settle();

    expect(useLibraryStore.getState().library.books[0].folderId).toBe('folder1');
  });

  it('moves a book from the more menu folder picker', async () => {
    const folder = makeFolder({ id: 'folder1', name: 'Reading' });
    const book = makeBook({ id: 'b1', title: 'Unfiled' });
    seedLibrary({ books: [book], folders: [folder], lastUpdated: 1 });
    const { container } = mountSidebar();

    await clickBookAction(container, 'Unfiled', '移动到文件夹');

    const modal = container.querySelector('.modal-assign-folder') as HTMLElement;
    const folderOption = Array.from(modal.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Reading',
    )!;
    click(folderOption);
    await settle();

    expect(useLibraryStore.getState().library.books[0].folderId).toBe('folder1');
    expect(container.querySelector('.modal-assign-folder')).toBeNull();
  });

  it('leaves a book unchanged when dropped onto its current folder', async () => {
    const folder = makeFolder({ id: 'folder1', name: 'Reading' });
    const book = makeBook({ id: 'b1', title: 'Filed', folderId: 'folder1' });
    seedLibrary({ books: [book], folders: [folder], lastUpdated: 1 });
    const { container } = mountSidebar();
    await settle();

    const { dataTransfer } = dispatchDragEvent(container.querySelector('.book-item')!, 'dragstart');
    dispatchDragEvent(findUserFolderGroup(container, 'Reading'), 'drop', dataTransfer);
    await settle();

    expect(useLibraryStore.getState().library.books[0].folderId).toBe('folder1');
    expect(useLibraryStore.getState().library.lastUpdated).toBe(1);
  });

  it('moves a dragged book back to unfiled', async () => {
    const folder = makeFolder({ id: 'folder1', name: 'Reading' });
    const book = makeBook({ id: 'b1', title: 'Filed', folderId: 'folder1' });
    seedLibrary({ books: [book], folders: [folder], lastUpdated: 1 });
    const { container } = mountSidebar();
    await settle();

    const { dataTransfer } = dispatchDragEvent(container.querySelector('.book-item')!, 'dragstart');
    dispatchDragEvent(await findOrganizerButton(container, '未归档书籍'), 'drop', dataTransfer);
    await settle();

    expect(useLibraryStore.getState().library.books[0].folderId).toBeUndefined();
  });

  it('auto-expands a collapsed folder while a book is dragged over it', async () => {
    const folder = makeFolder({ id: 'folder1', name: 'Reading' });
    const book = makeBook({ id: 'b1', title: 'Filed', folderId: 'folder1' });
    const unfiled = makeBook({ id: 'b2', title: 'Loose' });
    localStorage.setItem('creader-library-organizer-expanded-folders', JSON.stringify([]));
    seedLibrary({ books: [book, unfiled], folders: [folder], lastUpdated: 1 });
    const { container } = mountSidebar();
    await settle();
    expect(Array.from(container.querySelectorAll('.book-item')).map(el => el.textContent).join(' ')).not.toContain('Filed');

    vi.useFakeTimers();
    const { dataTransfer } = dispatchDragEvent(container.querySelector('.book-item')!, 'dragstart');
    dispatchDragEvent(findUserFolderGroup(container, 'Reading'), 'dragover', dataTransfer);
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    vi.useRealTimers();
    await settle();

    expect(container.textContent).toContain('Filed');
    expect(JSON.parse(localStorage.getItem('creader-library-organizer-expanded-folders') || '[]')).toEqual(['folder1']);
  });
});

describe('Sidebar contract — folder modal (add + edit)', () => {
  it('disables the create button when the name is empty and creates a colorless folder when filled', async () => {
    seedLibrary({ books: [], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar();
    expect(container.querySelector('.modal-folder')).toBeNull();

    click(findSidebarActionButton(container, '新文件夹'));
    await settle();

    const modal = container.querySelector('.modal-folder') as HTMLElement;
    const nameInput = modal.querySelector('input') as HTMLInputElement;
    const createBtn = Array.from(modal.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '创建',
    )!;
    expect(createBtn.disabled).toBe(true);

    setInputValue(nameInput, '  Favorites  ');
    expect(createBtn.disabled).toBe(false);
    click(createBtn);
    await settle();

    const folder = useLibraryStore.getState().library.folders[0];
    expect(folder.name).toBe('Favorites');
    expect('color' in folder).toBe(false);
    expect(container.querySelector('.modal-folder')).toBeNull();
  });

  it('rejects duplicate folder names case-insensitively', async () => {
    const folder = makeFolder({ id: 'folder1', name: 'Favorites' });
    seedLibrary({ books: [], folders: [folder], lastUpdated: 1 });
    const { container } = mountSidebar();

    click(findSidebarActionButton(container, '新文件夹'));
    await settle();

    const modal = container.querySelector('.modal-folder') as HTMLElement;
    const nameInput = modal.querySelector('input') as HTMLInputElement;
    const createBtn = Array.from(modal.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '创建',
    )!;

    setInputValue(nameInput, 'favorites');
    expect(createBtn.disabled).toBe(true);
    click(createBtn);
    await settle();

    expect(useLibraryStore.getState().library.folders).toHaveLength(1);
  });

  it('opens the edit-folder modal pre-filled and commits the rename without adding color', async () => {
    const folder = makeFolder({ id: 'folder1', name: 'Old Name' });
    seedLibrary({ books: [], folders: [folder], lastUpdated: 1 });
    const { container } = mountSidebar();

    await findOrganizerButton(container, 'Old Name');
    click(container.querySelector('[aria-label="Old Name 操作"]')!);
    await settle();
    const editBtn = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (item) => item.textContent?.trim() === '编辑文件夹',
    )!;
    click(editBtn);
    await settle();

    const modal = container.querySelector('.modal-folder') as HTMLElement;
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
    expect(container.querySelector('.modal-folder')).toBeNull();
  });

  it('keeps the folder action button accessible without rendering a tooltip trigger', () => {
    const folder = makeFolder({ id: 'folder1', name: 'Reading' });
    seedLibrary({ books: [], folders: [folder], lastUpdated: 1 });
    const { container } = mountSidebar();

    const actionButton = container.querySelector('[aria-label="Reading 操作"]') as HTMLButtonElement | null;
    expect(actionButton).not.toBeNull();
    expect(actionButton!.getAttribute('aria-describedby')).toBeNull();
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('closes when the overlay is clicked without creating a folder', async () => {
    seedLibrary({ books: [], folders: [], lastUpdated: 1 });
    const { container } = mountSidebar();
    click(findSidebarActionButton(container, '新文件夹'));
    await settle();

    click(container.querySelector('.modal-overlay')!);
    await settle();

    expect(container.querySelector('.modal-folder')).toBeNull();
    expect(useLibraryStore.getState().library.folders).toHaveLength(0);
  });

  it('deletes a folder after confirmation and moves books to unfiled', async () => {
    setNextConfirmResult(true);
    const folder = makeFolder({ id: 'folder1', name: 'Reading' });
    const book = makeBook({ id: 'b1', title: 'Filed', folderId: 'folder1' });
    seedLibrary({ books: [book], folders: [folder], lastUpdated: 1 });
    const { container } = mountSidebar();

    click(container.querySelector('[aria-label="Reading 操作"]')!);
    await settle();
    const deleteBtn = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (item) => item.textContent?.trim() === '删除文件夹',
    )!;
    click(deleteBtn);
    await settle();

    expect(useLibraryStore.getState().library.folders).toHaveLength(0);
    expect(useLibraryStore.getState().library.books[0].folderId).toBeUndefined();
    expect(getConfirmCalls()[0].title).toBe('删除文件夹');
  });

  it('persists manual folder reorder through sortOrder without moving books', async () => {
    const folderA = makeFolder({ id: 'folder-a', name: 'Alpha', sortOrder: 0 });
    const folderB = makeFolder({ id: 'folder-b', name: 'Beta', sortOrder: 1 });
    const book = makeBook({ id: 'b1', title: 'Filed', folderId: 'folder-a' });
    seedLibrary({ books: [book], folders: [folderA, folderB], lastUpdated: 1 });
    const { container } = mountSidebar();
    await settle();

    const groups = userFolderGroups(container);
    const { dataTransfer } = dispatchDragEvent(groups[1], 'dragstart');
    dispatchDragEvent(groups[0], 'dragover', dataTransfer);
    dispatchDragEvent(groups[0], 'drop', dataTransfer);
    await settle();

    expect(useLibraryStore.getState().library.folders.map(folder => [folder.id, folder.sortOrder])).toEqual([
      ['folder-b', 0],
      ['folder-a', 1],
    ]);
    expect(useLibraryStore.getState().library.books[0].folderId).toBe('folder-a');
  });
});
