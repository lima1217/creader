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
Operations that need access to an entire book rather than the currently displayed passage. CReader avoids whole-book reader features such as search indexing, import-time rebuilds, and search panels. AI tools may fetch a specific chapter on demand through Rust text extraction, but that is not a reader search surface.
_Avoid_: reader UI work, chapter rendering, search index lifecycle

**Continuous Scroll Feel**:
The whole-book scrolling experience CReader ships without a custom continuous renderer (ADR-0021): foliate's `flow=scrolled` for in-section scroll, the Scrolled Boundary Bridge for cross-chapter advance, and the Whole-Book Progress Bar for whole-book position sense. Layout is fixed `flow=scrolled`; there is no `flow` user setting and no single-document virtualization.
_Avoid_: custom continuous renderer, second engine, virtualized whole-book DOM, paginated mode toggle

**Scrolled Boundary Bridge**:
The adapter logic that, in `flow=scrolled`, detects when the reader reaches a section boundary and drives `view.next()` / `view.prev()` to load the adjacent chapter, preloading it to reduce the seam feel. It arms (rather than fires) on first boundary contact and advances once accumulated scroll intent clears a threshold, signalled by the Boundary Arm Indicator.
_Avoid_: native continuous scroll, section virtualization, manual page-turn at chapter edges

**Boundary Arm Indicator**:
The thin token-only progress hairline shown at the top edge (prev) or bottom edge (next) while the reader is armed at a chapter boundary. It fills 0–1 as scroll intent accumulates toward a boundary turn. Sits in the Reading Chrome, not the engine's content tree.
_Avoid_: page-turn button, loading spinner, chapter-break divider

**Whole-Book Progress Bar**:
The app-drawn reader progress surface that shows whole-book fraction (not just the current chapter the native scrollbar reflects), with chapter tick marks from `getSectionFractions` and drag-to-seek via `seekToFraction`. It replaces overlay nav buttons and the native scrollbar as the whole-book position sense.
_Avoid_: native scrollbar, per-chapter progress bar, overlay nav buttons

**Chapter Text Retrieval**:
A Rust-local AI tool capability that extracts plain text for a requested EPUB chapter on demand. It supports source-grounded AI answers without rendering book content or building a whole-book index.
_Avoid_: Reading Engine, search index, import-time extraction

**AI Tool Loop**:
The bounded Rust orchestration loop that receives model tool calls, executes local tools such as chapter retrieval or Reading Memory writes, appends tool results, and resumes streaming.
_Avoid_: frontend tool executor, Node runtime, unbounded agent loop

**Generated Location Cache**:
The removed epubjs-era IndexedDB `locations` store for calculated page/location data. Current CReader treats it as migration-only legacy data; foliate location events drive progress.
_Avoid_: current progress source

**Reading Context Snapshot**:
A frozen record of what the reader was looking at or selecting when an AI message was sent.
_Avoid_: live reader state

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
The modal settings surface for AI-assisted reading. It has three top-level tabs: `AI 设置`, `阅读记忆`, and `快捷提示词`. The dialog does not repeat the `AI 设置` title above the tab row; the close control stays visible at the top.
_Avoid_: AI Reading Console, Console Overview, readiness dashboard

**AI Settings Tab**:
The AI Settings Dialog tab that configures how the reading conversation runs: OpenAI-compatible providers, active model/key setup, explicit connection tests, context window, hidden conversation summarization, and AI panel text size.
_Avoid_: split AI Service Settings and Conversation Behavior Settings, provider health dashboard

**AI Service Ready**:
The local boolean that is true only when an active provider has a stored key. If false, the `AI 设置` tab shows a small attention dot; there is no positive ready marker.
_Avoid_: three-level Console Readiness, Reading Memory/Quick Prompt degradation

**Reading Memory Settings Tab**:
The AI Settings Dialog tab for choosing, opening, replacing, and enabling automatic ingestion for the Reading Memory repository.
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

**Drag-and-Drop Import**:
The EPUB import path that accepts files dropped onto the sidebar or the reader window, routed through the same `BookImportService` as the file-picker import. It imports books, not arbitrary files; the drop target rejects non-EPUB input.
_Avoid_: native file dialog only, arbitrary file import, OS file watcher

**Reading Chrome**:
The React-tree UI around the rendered book body — toolbar, TOC drawer, progress bar, selection toolbar — as distinct from the book content the Reading Engine renders into its own content tree. Astryx components own chrome; they do not own the engine's rendered body.
_Avoid_: "the reader" used to mean both the chrome and the book body interchangeably

**Paper Workspace Palette**:
CReader's single warm color palette, mapped onto two token systems from the same colors: native chrome tokens in `src/index.css` (`--bg-*`, `--text-*`, `--accent`, …) and Astryx `--color-*` tokens defined once in `src/theme/paperTheme.ts`. There are only two modes, `light` (亮色) and `dark` (暗色).
_Avoid_: sepia/护眼 theme, a second parallel palette, overriding `--color-*` in `:root`

**Book-Body Palette**:
The three colors the reading engine injects into the rendered EPUB body — background, text, link — held as the single source of truth in `paperBodyPalette` (`src/theme/paperTheme.ts`) and consumed by both the Astryx body tokens and the reading-engine theme bridge (`epubTheme.ts`). The bridge injects literal values because foliate section documents do not inherit the host `:root`.
_Avoid_: hard-coded body colors in the engine bridge, `var(--color-*)` inside foliate section docs

**Built-in Reading Font**:
The single bundled reading font stack CReader ships — Roboto (Latin) and LXGW WenKai (CJK) — exposed via the font catalog and `@font-face` host injection. Font selection UI and custom-font import were removed (PRs #103/#104); there is no font picker and no per-user font whitelist. Bold Chinese text is rendered with a synthetic bold face so LXGW WenKai stays legible.
_Avoid_: font picker, custom font import, user font whitelist, Bitter

**Per-Section Font Stack**:
The language-aware choice of font stack per foliate section document: Latin-first (`CReader Roboto`, then `CReader LXGW WenKai`) for western sections and CJK-first (the reverse order) for Chinese/Japanese/Korean sections, plus CJK first-line indent and per-language line height. Driven by section language detection, not a global setting.
_Avoid_: global CJK toggle, single mixed stack with fixed order

**Selection Coordinate**:
An `{x, y}` pixel position produced by the reading engine's selection listeners and consumed by the SelectionToolbar. The Reading Engine Adapter emits coordinates, never a DOM anchor node; this is why the selection toolbar cannot use trigger-anchored overlays like Astryx `Popover`/`Tooltip`.
_Avoid_: selection anchor, selection ref
