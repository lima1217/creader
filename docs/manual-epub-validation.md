# Manual EPUB Validation

Use this checklist for core reading-loop changes that cannot be covered reliably
by unit tests because they depend on real foliate-js layout, EPUB internals, or
Tauri file access.

## Core Daily-Use Cases

- Missing file: open a library book whose original file was moved or deleted.
  Expect a recoverable "找不到书籍文件" state with a visible original path and a
  working "重新定位文件" action.
- Corrupt or unsupported EPUB: open a non-EPUB file renamed to `.epub` or an EPUB
  foliate-js cannot parse. Expect "无法打开书籍" copy that explains CReader only
  supports standard EPUB files and does not expose raw stack traces as the main
  message.
- Progress restore: open a book, move at least two pages, quit and restart the
  app, then reopen the same book. Expect the first displayed location to be the
  last stored CFI, not the beginning.
- Book switch restore: switch from book A to book B, navigate both, then switch
  back to book A. Expect each book to restore its own last stored CFI.
- Flat TOC navigation: use a book with top-level chapters and click several
  chapter entries. Expect the TOC to close and the visible page to move to the
  chosen chapter.
- Nested TOC navigation: use a book with at least three TOC levels. Expect nested
  entries to render, click, and highlight correctly when the current location is
  inside the same spine document or exact fragment.
- Selection toolbar: select short and long text near the top, center, and bottom
  of the viewport. Expect the toolbar to appear only for non-empty selection,
  stay inside viewport edges, keep the selected text for "问 AI", and dismiss
  after close, page navigation, outside click, or Escape.
- Search precise locator: search in a book with a ready index where results carry
  EPUB CFI locators. Expect clicking a result to close search and jump to the
  precise visible passage.
- Search coarse locator: search in a book where results only carry href or spine
  locators. Expect clicking a result to close search and jump to the chapter or
  section rather than doing nothing.
- Live theme switch: while a book is open, switch light/dark theme and adjust
  font settings. Expect both reader chrome and rendered book body to use coherent
  background, text, and link colors without waiting for a page turn.
