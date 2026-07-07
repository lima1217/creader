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
- Live theme switch: while a book is open, switch light/dark theme and adjust
  font settings. Expect both reader chrome and rendered book body to use coherent
  background, text, and link colors without waiting for a page turn.
- Continuous scroll across chapters: open a multi-chapter book, scroll to the
  end of a chapter, and keep scrolling. Expect the boundary arm hairline to
  appear and fill, then the next chapter to load and preload its neighbor.
  Repeat at the previous-edge (scroll up at a chapter start). Confirm there is
  no `flow` setting anywhere in Settings.
- Whole-book progress bar: open a multi-chapter book. Expect the progress bar
  to show whole-book fraction with chapter tick marks (not just the current
  chapter). Drag the progress bar to ~50% and release; expect the view to jump
  to that whole-book position and the relocated CFI / percentage to match.
- Per-section font stack: open a book mixing Latin and Chinese sections. Expect
  Latin sections to render Latin-first (Roboto) and Chinese sections to render
  CJK-first (LXGW WenKai) with first-line indent and CJK line height, and bold
  Chinese text to stay legible. Confirm there is no font picker in the toolbar.
- Drag-and-drop import: drag a valid EPUB onto the sidebar and onto the reader
  window. Expect the book to import through the normal import path and appear
  in the library. Drag a non-EPUB file; expect it to be rejected, not imported.
