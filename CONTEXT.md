# CReader Context

CReader is a local-first reading application for EPUB books, reading-context AI conversation, and selective source-grounded Reading Memory.

## Language

**Reading Engine**:
The part of CReader that renders book content, tracks locations, exposes selection context, and lets the reader move through an EPUB.
_Avoid_: EPUB widget, viewer

**Reading Engine Adapter**:
The small contract between CReader's reader-facing features and the single `foliate-js` Reading Engine.
_Avoid_: engine-specific UI branch, renderer switch scattered through components

**Scripted EPUB**:
An EPUB that depends on embedded book scripts for its reading behavior. CReader does not support scripted EPUB execution.
_Avoid_: safe mode, fallback renderer support

**Whole-Book Work**:
Operations that need access to an entire book rather than the currently displayed passage, such as full-text extraction and search indexing.
_Avoid_: reader UI work, chapter rendering

**Search Index**:
A rebuildable local representation of a book's text used to answer search queries without loading the whole book into the WebView.
_Avoid_: book storage, source of truth

**Generated Location Cache**:
The removed epubjs-era IndexedDB `locations` store for calculated page/location data. Current CReader treats it as migration-only legacy data; foliate location events drive progress.
_Avoid_: current progress source, search index

**Search Locator**:
A search result location that may point to a precise CFI or to a coarser EPUB spine item or href when precise CFI generation is not yet reliable.
_Avoid_: always-CFI result, rendered selection

**Reading Context Snapshot**:
A frozen record of what the reader was looking at or selecting when an AI message was sent.
_Avoid_: live reader state, search index context

**AI Provider**:
A user-configured OpenAI-compatible HTTP endpoint, model, and local API key used by the backend to serve chat and Reading Memory review.
_Avoid_: frontend-selected model per request, local CLI provider

**Conversation Memory**:
A hidden summary of older chat turns used to keep the AI conversation coherent without rendering the summary as a visible message.
_Avoid_: Reading Memory note, chat message

**Quick Prompt**:
A user-editable shortcut prompt shown near the AI input and persisted by the quick actions module.
_Avoid_: provider setting, hard-coded AI mode

**AI Settings Dialog**:
The modal settings surface for AI-assisted reading. It has three top tabs: `AI`, `阅读记忆`, and `快捷提示词`.
_Avoid_: AI Reading Console, Console Overview, readiness dashboard

**AI Settings Tab**:
The AI Settings Dialog tab that configures how the reading conversation runs: OpenAI-compatible providers, active model/key setup, explicit connection tests, context window, hidden conversation summarization, and AI panel text size.
_Avoid_: split AI Service Settings and Conversation Behavior Settings, provider health dashboard

**AI Service Ready**:
The local boolean that is true only when an active provider has a stored key. If false, the `AI` tab shows a small attention dot; there is no positive ready marker.
_Avoid_: three-level Console Readiness, Reading Memory/Quick Prompt degradation

**Reading Memory Settings Tab**:
The AI Settings Dialog tab for choosing, opening, disconnecting, and enabling automatic ingestion for the Reading Memory repository.
_Avoid_: internal memory database, readiness blocker

**Quick Prompt Settings Tab**:
The AI Settings Dialog tab for editing, ordering, hiding, adding, and restoring Quick Prompts. The first six prompts render directly in the AI panel; overflow goes into the more menu.
_Avoid_: provider setting, static shortcut list

**Reading Memory**:
A user-selected local Markdown repository where CReader writes durable, source-grounded notes from selected reading conversations.
_Avoid_: internal memory database, chat history

**Note Intent**:
A structured description of a durable Reading Memory note before it is rendered as Markdown and written to disk.
_Avoid_: raw note markdown, AI-selected file path

**Markdown Writer Boundary**:
The split where CReader turns a note intent into valid OKF Markdown while still restricting where that Markdown may be written.
_Avoid_: markdown string concatenation, unrestricted file write

**Reading Memory Package**:
The OKF-compatible root repository plus one sub-package per book, where current-book notes are written under the sanitized book slug.
_Avoid_: flat app export folder, cross-book scratch directory

**Book Folder**:
A flat, single-owner grouping inside the local library. A book can belong to at most one Book Folder at a time; moving a book between folders changes its library grouping, not the EPUB file's disk location.
_Avoid_: tag, category, collection, nested folder

**Library Organizer**:
The left-side library surface for continuing reading, seeing Book Folders, and moving books between folders. It is a book organization surface, not merely a filter sidebar.
_Avoid_: bookmark bar, category filter, tag sidebar, file tree

**Reading Chrome**:
The React-tree UI around the rendered book body — toolbar, TOC drawer, search overlay, progress bar, selection toolbar — as distinct from the book content the Reading Engine renders into its own content tree. Astryx components own chrome; they do not own the engine's rendered body.
_Avoid_: "the reader" used to mean both the chrome and the book body interchangeably

**Selection Coordinate**:
An `{x, y}` pixel position produced by the reading engine's selection listeners and consumed by the SelectionToolbar. The Reading Engine Adapter emits coordinates, never a DOM anchor node; this is why the selection toolbar cannot use trigger-anchored overlays like Astryx `Popover`/`Tooltip`.
_Avoid_: selection anchor, selection ref
