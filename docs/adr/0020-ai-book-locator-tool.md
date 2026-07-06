# AI On-Demand Book Locator (`search_book`)

**Status: Accepted**

CReader adds an AI-only `search_book` tool that linearly scans chapter plain text to locate where a keyword or phrase appears. This is not a return of reader whole-book search.

## Context

ADR-0018 removed toolbar search, `Cmd+F`, Tantivy indexing, and import-time index builds. ADR-0019 added on-demand chapter tools (`list_chapters`, `get_chapter_text`) for source-grounded AI answers without a Reading Engine or search index.

With only those two tools, models answering “where does the book discuss X?” must page through chapters one by one. A single turn can exhaust the bounded tool loop and still miss matches.

Readers do not need whole-book search for CReader’s core workflow. AI-assisted location is a different product surface: it helps the model choose which chapter to read next, not replace TOC navigation or in-reader find.

## Decision

| Reader whole-book search (ADR-0018 removed) | AI `search_book` (this ADR) |
|---|---|
| Toolbar / `Cmd+F` / search panel | AI tool-calling only |
| Tantivy persistent index | On-demand linear scan, no index |
| Import-time index build | No import side effects |
| Search index UI state machine | No UI state |

- Add `search_book(query, limit?)` implemented in `book_text.rs`.
- Matching is naive substring (`str::contains`); no jieba or fuzzy ranking in this phase.
- Return `{ hits: { index, title, excerpt }[], truncated: bool }`.
- Hard caps: scan at most **200** chapters, return at most **20** hits, **15s** deadline inside `spawn_blocking`.
- When a cap or timeout fires, return partial hits with `"truncated": true`.
- Register the tool in `reading_ai_tools`, `execute_local_tool`, `tool_activity_detail`, and `reading_ai_system.md`.
- Include `search_book` in the read-only tool result deduplication from issue #80.

## Rationale

A lightweight scan reuses the existing text-only EPUB extractor and chapter LRU cache without resurrecting index lifecycle, import CPU spikes, or reader UI. Substring search is predictable, cheap to implement, and sufficient for “which chapter mentions this term?”

Bounding chapters, hits, and wall time keeps large books from blocking the async runtime or freezing the chat surface.

## Relationship to Other ADRs

- **ADR-0018** still stands: no reader search UI, Tantivy, or import indexing. `search_book` does not supersede or reopen that track.
- **ADR-0019** still stands: tools run locally in Rust, `book_text.rs` is not a Reading Engine, and the tool loop stays bounded. `search_book` extends the same module rather than adding a second text pipeline.

## Consequences

- Models can locate candidate chapters in one tool call before calling `get_chapter_text`.
- Large books may return truncated partial results; the system prompt should tell the model to narrow the query or read specific chapters when `truncated` is true.
- Scanning touches more chapter bytes than single-chapter fetch; the shared chapter cache from issue #81 amortizes repeat reads but first-time scans remain I/O bound.

## Non-Goals

- No reader search panel, toolbar control, or keyboard shortcut.
- No persistent or import-time index.
- No jieba tokenization, relevance ranking, or fuzzy match in this phase.
- No whole-book text materialization into the model context; only short excerpts per hit.
