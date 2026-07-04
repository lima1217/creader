# PRD: Library Organizer and Book Folders

## Status

Implemented in #56–#60. This document remains the product reference for Library Organizer behavior.

## Summary

CReader's left-side library surface should become a **Library Organizer**: a quiet, Astryx-based surface for continuing reading, seeing flat Book Folders, and moving books between folders. This replaces the old category/filter mental model with an expandable folder bookshelf.

Book Folders are flat, single-owner library groupings. A book can belong to at most one folder, and moving a book changes only library organization; it never moves or deletes the EPUB file on disk.

## Goals

1. Replace the old category/tag vocabulary with Book Folder vocabulary in domain, UI, and code.
2. Preserve existing local library grouping through a compatibility migration from `categories/categoryId` to `folders/folderId`.
3. Make the left sidebar a Library Organizer, not a simple filter sidebar.
4. Support manual folder ordering and folder expansion.
5. Support moving books between folders through native drag/drop and a non-drag menu fallback.
6. Keep books system-ordered by current/recent reading activity.
7. Use Astryx components as the foundation while allowing small custom structures for drag state, drop zones, and expandable folder shelves.

## Non-Goals

- Do not support nested folders in the first version.
- Do not support multi-folder books or tags.
- Do not support manual book ordering.
- Do not make `All Books` a drop target.
- Do not add a DnD dependency for the first version.
- Do not move EPUB files on disk when moving books between folders.
- Do not implement EPUB full-text search inside the Library Organizer search.
- Do not keep color as part of the folder model.

## Domain Decisions

- **Book Folder** replaces the old category concept.
- A Book Folder is flat and single-owner.
- A book has at most one `folderId`.
- A folder has `id`, `name`, `sortOrder`, and `createdAt`.
- Old `categoryId` and `categories` data should hydrate into `folderId` and `folders`.
- Old category array order should hydrate into folder `sortOrder`.
- Old category colors are discarded during migration.
- New writes should use only the folder model.
- UI copy should use `书库`, `文件夹`, and `未归档`; avoid `书签栏`, `分类`, and `标签`.

## Product Shape

The Library Organizer has three conceptual areas:

1. **Continue Reading**  
   A fixed, minimal entry for the current book or most recently read book. It is an access shortcut, not a folder membership substitute.

2. **Library Search**  
   A local organizer search over book title and author. It shows matching books inside their folder context, does not search book content, and does not use the Search Index.

3. **Expandable Folder Bookshelf**  
   A flat list of folders plus `未归档`. Folders can expand to show their books. Books remain ordered by current/recent reading activity.

`全部书籍` remains a view/search entry. It is not a folder and not a drop target.

## Interaction Rules

- Users can create, rename, delete, expand, collapse, and reorder folders.
- Folder names are trimmed before saving.
- Folder names must be unique after case-insensitive comparison.
- Deleting a folder moves its books to `未归档`.
- New folders are appended at the end of the folder order.
- Dragging folders rewrites folder `sortOrder`; no separate `folderOrder` list is stored.
- Multiple folders can be expanded at the same time.
- On first load, expand the current book's folder when possible.
- If no current book exists, expand `未归档` or the most recently used folder.
- Expanded folders are remembered across app restarts as UI state, not Library domain data.
- If the current book's folder is not expanded on startup, the Library Organizer still expands it.
- Deleted folder ids are removed from remembered expansion state.
- Search does not permanently change remembered expansion state.
- During search, show only folders that contain matching books.
- During search, matching folders are expanded and show only matching books.
- `未归档` appears during search only when it contains matching books.
- Clearing search restores the previous expansion state.
- While dragging a book, hovering over a collapsed folder should auto-expand it after a short delay.
- Dragging a book to a real folder sets that book's `folderId`.
- Dragging a book to `未归档` clears that book's `folderId`.
- Dragging a book to its current folder is a no-op.
- Dragging a book to `全部书籍` is not allowed.
- Dragging a folder changes folder order only.
- Dragging a book changes folder membership only.

## Astryx UI Direction

Use Astryx for foundational UI: `Layout`, `SideNav`, `List`, `ListItem`, `Button`, `IconButton`, `MoreMenu`, `Dialog`, and `TextInput` where they fit.

Small custom structures are allowed for:

- expandable folder shelf rows,
- folder drop zones,
- drag-over and auto-expand state,
- book rows inside folder shelves.

CSS supplements should use design tokens and avoid raw colors or dimensions unless the local Astryx convention already allows them.

## Proposed Issue Chain

### 1. Book Folder Data Model and Compatibility Migration

Replace `BookCategory`/`categoryId` with `BookFolder`/`folderId`. Hydrate old local library data into the new shape, discard old colors, and write only the new model.

Acceptance criteria:

- Existing local libraries with `categories/categoryId` keep folder names and book membership.
- New persisted library data uses `folders/folderId`.
- Folder model has no color field.
- Store tests cover migration, folder creation, rename, deletion, and membership moves.
- `npm run typecheck` and `npm run test` pass.

### 2. Library Organizer Base Layout

Replace the old filter-sidebar structure with the Library Organizer shape: continue reading, organizer search, `全部书籍`, `未归档`, and expandable Book Folders.

Acceptance criteria:

- The top area shows the current or most recently read book.
- Search filters by book title and author only.
- Search results stay grouped by folder context.
- Clearing search restores the previous expansion state.
- Folder expansion supports multiple open folders.
- Current book's folder is expanded on first entry when possible.
- Existing book open, edit, remove, and settings actions still work.
- UI copy avoids category/tag/bookmark-bar language.

### 3. Book Drag/Drop Movement

Implement native browser drag/drop for moving books into folders or `未归档`, plus a non-drag menu fallback.

Acceptance criteria:

- Book rows are draggable with a `bookId` payload.
- Real folders and `未归档` are drop targets.
- `全部书籍` is not a drop target.
- Dropping onto the current folder is a no-op.
- Hovering over a collapsed folder during drag auto-expands it after a short delay.
- The menu fallback can move a book to any folder or `未归档`.

### 4. Folder Management and Ordering

Implement folder create, rename, delete, and manual ordering.

Acceptance criteria:

- Folder names are trimmed and cannot be empty.
- Folder names are unique case-insensitively.
- Deleting a folder moves its books to `未归档`.
- Folder drag ordering persists.
- Folder ordering is stored on `BookFolder.sortOrder`.
- Book ordering remains current/recent reading based.

### 5. Astryx Polish and Contract Test Closure

Polish the Library Organizer with Astryx components, token CSS, and behavior-focused tests.

Acceptance criteria:

- Astryx owns the reusable controls where it fits.
- Custom DOM is limited to folder shelf/drop/drag structures.
- Old category/tag styling and copy are removed.
- Sidebar/Library Organizer contract tests cover core behavior without depending on Astryx internals.
- `npm run typecheck`, `npm run test`, and `npm run build` pass.

## Verification Plan

- Data model slices: `npm run typecheck` and focused `npm run test`.
- UI behavior slices: focused Sidebar/Library Organizer tests and `npm run typecheck`.
- Broad handoff: `npm run check`.

## Open Questions

No open product decisions remain from the grilling session.
