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

**AI Reading Console**:
The settings surface that shows and changes the runtime state for AI-assisted reading, including provider health, model selection, conversation behavior, Reading Memory writes, and quick prompts.
_Avoid_: preferences screen, static settings form

**Console Overview**:
The default AI Reading Console view that summarizes whether the reading AI runtime is ready, degraded, or missing required setup before the reader edits individual configuration areas.
_Avoid_: first settings tab, passive preferences summary

**Console Readiness**:
The AI Reading Console's three-level status model: ready, degraded, or missing setup. "Degraded" means the reading conversation can still run, but an adjacent capability such as Reading Memory or quick prompts is unavailable or intentionally disabled.
_Avoid_: binary enabled/disabled status, generic health check

**AI Service Settings**:
The AI Reading Console area for OpenAI-compatible provider records, active model selection, endpoint configuration, and local API key status.
_Avoid_: conversation settings, prompt settings

**Conversation Behavior Settings**:
The AI Reading Console area for how reading conversations behave at runtime, including context window size, hidden conversation summarization, and AI panel text size.
_Avoid_: provider settings, Reading Memory settings

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

**Reading Chrome**:
The React-tree UI around the rendered book body — toolbar, TOC drawer, search overlay, progress bar, selection toolbar — as distinct from the book content the Reading Engine renders into its own content tree. Astryx components own chrome; they do not own the engine's rendered body.
_Avoid_: "the reader" used to mean both the chrome and the book body interchangeably

**Selection Coordinate**:
An `{x, y}` pixel position produced by the reading engine's selection listeners and consumed by the SelectionToolbar. The Reading Engine Adapter emits coordinates, never a DOM anchor node; this is why the selection toolbar cannot use trigger-anchored overlays like Astryx `Popover`/`Tooltip`.
_Avoid_: selection anchor, selection ref
