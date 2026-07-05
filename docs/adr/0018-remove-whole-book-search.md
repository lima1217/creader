# Remove Whole-Book Search and Rust Search Indexing

CReader will not ship whole-book search or a Rust-side full-text index. The product stays a lightweight local EPUB reader focused on reading flow, TOC navigation, selection-driven AI conversation, and selective Reading Memory writes.

## Decision

- Remove the toolbar search control, reader search panel, `Cmd+F` shortcut, and all Tauri search/index commands.
- Remove `src-tauri/src/search_index.rs` and dependencies on `tantivy`, `tantivy-jieba`, `regex`, `roxmltree`, and `zip` that existed only for indexing.
- Import adds the book to the library only; it does not kick off background indexing.
- Drop `Book.searchIndex` and related UI states (`missing`, `pending`, `ready`, `failed`, `stale`).

## Rationale

The Rust Search Index improved whole-book lookup but added heavy import-time CPU use, extra native dependencies, and operational complexity disproportionate to CReader's core reading + AI workflow. Users can still navigate by TOC, relocate within a chapter, select text for AI, and send the current chapter to the AI panel.

## What Stays Stable

- AI and Reading Memory continue to use the frozen Reading Context Snapshot, not any search-derived excerpt.
- foliate-js remains the only Reading Engine.
- TOC href navigation through `display` remains the primary in-book navigation affordance beyond prev/next.

## Supersedes

This ADR supersedes the Rust search indexing track and related ADRs:

- `0001-rust-indexing-before-renderer-migration.md`
- `0002-search-index-is-derived-data.md`
- `0003-search-index-does-not-own-ai-context.md` (search-specific scope only; the AI context rule itself remains valid)
- `0005-keep-client-state-and-storage-refactors-out-of-search-indexing.md`
- `0006-keep-ai-client-migration-separate-from-search-indexing.md` (search-coupling scope only)
- `0007-allow-chapter-level-search-locators.md`
- `0008-keep-frontend-search-fallback-during-rust-index-rollout.md`
- `0009-deliver-rust-search-as-vertical-slices.md`
- `0010-spike-epub-parser-before-locking-rust-dependency.md`
- `docs/rust-search-indexing-roadmap.md`

## Legacy Data

Existing `search-indexes/` directories under the app data dir are orphaned and safe to delete manually. Persisted library JSON may still contain a `searchIndex` field from older versions; current code ignores it.
