# CReader Context

CReader is a local-first reading application for EPUB books, reading-context AI conversation, and selective source-grounded Reading Memory.

## Language

**Reading Engine**:
The part of CReader that renders book content, tracks locations, exposes selection context, and lets the reader move through an EPUB.
_Avoid_: EPUB widget, viewer

**Whole-Book Work**:
Operations that need access to an entire book rather than the currently displayed passage, such as full-text extraction and search indexing.
_Avoid_: reader UI work, chapter rendering

**Search Index**:
A rebuildable local representation of a book's text used to answer search queries without loading the whole book into the WebView.
_Avoid_: book storage, source of truth

**Search Locator**:
A search result location that may point to a precise CFI or to a coarser EPUB spine item or href when precise CFI generation is not yet reliable.
_Avoid_: always-CFI result, rendered selection

**Reading Context Snapshot**:
A frozen record of what the reader was looking at or selecting when an AI message was sent.
_Avoid_: live reader state, search index context

**Reading Memory**:
A user-selected local Markdown repository where CReader writes durable, source-grounded notes from selected reading conversations.
_Avoid_: internal memory database, chat history

**Note Intent**:
A structured description of a durable Reading Memory note before it is rendered as Markdown and written to disk.
_Avoid_: raw note markdown, AI-selected file path

**Markdown Writer Boundary**:
The split where CReader turns a note intent into valid OKF Markdown while still restricting where that Markdown may be written.
_Avoid_: markdown string concatenation, unrestricted file write
