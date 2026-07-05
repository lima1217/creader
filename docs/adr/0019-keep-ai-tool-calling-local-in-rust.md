# Keep AI Tool Calling Local in Rust

**Status: Accepted**

CReader will add AI tool calling inside the existing Rust `async-openai` path. Rust owns the bounded tool loop, executes tools locally, and streams only user-visible events back to the frontend.

## Context

Issue #73 expands reading-context AI beyond the current selection and chapter excerpt. The AI needs to list chapters, fetch text for a chapter on demand, and request a durable Reading Memory write when a turn is worth saving.

The existing streaming path already lives in Rust and sends events to the frontend through a Tauri `Channel`. That channel is backend-to-frontend, so a frontend-driven tool loop would either fight the transport shape or require a second orchestration runtime. CReader also recently removed whole-book search and locked foliate-js as the only Reading Engine, so the new capability must not recreate those removed systems under another name.

## Decision

- Tool calls are orchestrated and executed in Rust, inside the current `async-openai` Chat Completions path.
- The frontend does not participate in the tool loop. It may display streamed chunks, done/error states, and lightweight tool activity emitted by Rust.
- CReader will not add Node, eve, or another runtime for AI tools.
- Chapter text extraction uses a new Rust text-only EPUB module, `book_text.rs`.
- `book_text.rs` is not a Reading Engine, does not render EPUB content, and does not replace or compete with the foliate-js Reading Engine Adapter.
- Chapter retrieval is on demand. CReader will not build a full-text index, rebuild at import time, or reintroduce a reader search panel.
- `get_chapter_text` may retrieve any chapter in the book. It is not capped by reading progress or spoiler limits.
- The tool loop is bounded by a small maximum number of rounds, initially four, and still respects the existing `AI_CANCEL_FLAG` plus request timeout behavior.
- API keys remain local to the backend provider store and key file. They do not return to the UI.
- Reading Memory writes continue to go only through the existing restricted write boundary. AI-selected paths must not write arbitrary files.

## Rationale

Keeping the loop in Rust preserves the current single-stack privacy and streaming model. The backend already resolves the active provider, owns API keys, and has access to Tauri commands for local file boundaries, so it is the narrowest place to combine model output, local tools, cancellation, and safe writes.

A text-only EPUB extractor is a separate concern from rendering. It gives AI tools enough source text to answer grounded questions without changing the reader body, foliate event bridge, selection coordinates, or theme injection.

On-demand chapter retrieval also avoids the complexity that caused whole-book search to be removed: no index lifecycle, no import CPU spike, no derived search status, and no new reader UI surface.

## Consequences

- #76 can implement `book_text.rs` as local text extraction without reopening the Reading Engine decision from ADR-0012.
- #77 can implement the tool loop in `src-tauri/src/ai.rs` or a Rust-side helper module without adding a frontend round trip for tool execution.
- #78 can expose tool activity as stream events, but those events are observational; the frontend does not decide or execute tools.
- ADR-0018 still stands: CReader does not ship whole-book search or Rust search indexing.
- Existing Reading Memory safety rules still stand: Markdown rendering and rewrite logic stay structured, while Rust validates paths and write targets.

## Non-Goals

- No reader search panel, toolbar search, `Cmd+F` whole-book search, import-time indexing, or search index status model.
- No scripted-EPUB support and no second Reading Engine.
- No arbitrary local file read/write tool surface.
- No frontend-selected provider/model fields in chat requests.
