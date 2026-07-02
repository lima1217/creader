# Rust Search Indexing Roadmap

This roadmap captures the agreed first optimization track for CReader: move whole-book search work out of the WebView and into Rust, while keeping renderer, AI, and broad client-state refactors separate.

## Goal

Make imported EPUB books searchable without loading or scanning the whole book in the WebView.

## Scope

In scope:

- Rust-side EPUB text extraction.
- Tantivy full-text index with Chinese segmentation.
- Tauri commands for indexing, status, retry, and search.
- Frontend search integration through the Rust Search Index.
- Chapter-level search locators when precise CFI is unavailable.

Out of scope for the first track:

- foliate-js reading engine migration.
- Replacing AI HTTP streaming with async-openai.
- Moving AI or Reading Memory context sourcing to the search index.
- Zustand migration.
- Dexie migration.
- Precise CFI generation for every search hit.

## Decisions

- Whole-book work moves to Rust before the reading engine is migrated.
- Search indexes are rebuildable derived data; import should still succeed when indexing fails.
- The Rust search index does not replace the frozen reading context snapshot used by AI and Reading Memory.
- Reading Memory Markdown rendering should use TypeScript AST tooling, while Rust remains the file safety boundary.
- Zustand and Dexie are later client cleanup tracks, not prerequisites for Rust indexing.
- async-openai is a later AI-client migration and must preserve the frontend streaming contract.
- Rust search results may initially use chapter or spine locators instead of precise CFI.
- Whole-book search now relies on the Rust Search Index; missing, pending, failed, and stale states stay visible in the search UI.
- Delivery should proceed through end-to-end vertical slices.
- The EPUB parser dependency should be proven by a parser spike before being locked.

## First Vertical Slice

1. Add a Rust parser spike for `rbook`, with `epub` as fallback.
2. Extract metadata, spine order, chapter href/idref, section title, and plain text from sample EPUB files.
3. Create a minimal Tantivy schema with book id, file fingerprint, section locator, section title, body text, and excerpt source fields.
4. Add a Rust search command that can search one indexed imported book and return ranked chapter-level results.
5. Connect the frontend search panel to the Rust command and remove the obsolete `searchBookCached` fallback.
6. Verify with `npm run typecheck`, `npm run test`, and `npm run build`; use `npm run check` before handoff of broad changes.

## Follow-Up Slices

- Broader real-book validation set for unusual EPUB packages.
- Precise CFI locators when they are reliable enough to add beside chapter locators.
- Real-book validation set for Chinese and English EPUB samples.
