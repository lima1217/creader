# Agent Guide

## Project Map
- `src/` contains the React/Vite frontend.
- `src/components/` contains the reader UI, toolbar, sidebar, AI panel, and selection controls.
- `src-tauri/` contains the Tauri shell and Rust commands used by the frontend.
- `public/` contains static assets served by Vite.
- `releases/` contains packaged release artifacts.

## Verification
- Use `npm run typecheck` for TypeScript validation.
- Use `npm run test` for the Vitest suite.
- Use `npm run build` for a full frontend and Tauri-facing production build check.
- Use `npm run check` as the default all-in-one verification command before handing off broad changes.

## Boundaries
- Keep UI component changes scoped to `src/components/` unless shared styling or app wiring is required.
- Keep native file, library, and platform behavior scoped to `src-tauri/`.
- When changing a Tauri command signature, update the frontend call sites in the same change.
- Do not edit generated release binaries in `releases/` unless the task is explicitly about packaging.

## Hotspots
- `src/components/AIPanel.tsx` and `src/components/AIPanel.css` own the AI panel experience; verify with `npm run typecheck` and `npm run build` after changes.
- `src/components/SettingsPanel.tsx` owns user-facing AI configuration, Reading Memory configuration, and quick prompt editing.
- `src/components/Sidebar.tsx` owns library navigation, tag actions, import actions, and the settings entry in the left sidebar.
- `src-tauri/src/lib.rs` owns native library and file operations; keep command names and payload shapes stable unless coordinated with frontend updates.
- Large shared styles in `src/index.css` and component CSS files should stay organized around existing selectors instead of introducing parallel styling systems.

## AI Panel
- Keep provider/model, Reading Memory, and quick prompt management in the settings panel instead of adding persistent configuration controls back into the AI panel.
- `SettingsPanel.tsx` groups controls under three primary tabs: `AI`, `Reading Memory`, and `快捷提示词`; keep new settings inside the matching tab instead of adding another top-level section.
- The AI panel should stay focused on reading-context conversation: header, message stream, quick prompt buttons, and input.
- Quick prompts are persisted by `src/components/ai/quickActions.tsx`; the AI panel shows up to six direct prompt buttons and moves overflow into the more menu.
- The AI input intentionally uses an empty placeholder for a quieter reading surface.
- AI is served over **OpenAI-compatible HTTP** (Chat Completions), not local CLIs. The user manages providers in Settings: each is a `{id, name, baseUrl, model}` config plus an API key. Provider configs live in `ai_providers.json` (app config dir); API keys live in `ai_keys.env` (app config dir, outside the repo) and are never shown back to the UI.
- Exactly one provider is "active" at a time; the backend (`chat_with_ai_streaming`, `summarize_ai_conversation`, `ingest_reading_memory_direct`) resolves the active config + key itself. The chat request carries only the prompt and reading context — no `provider`/`model` fields.
- The streaming contract is unchanged from the CLI era: Tauri `Channel<StreamEvent>` with `started`/`chunk`/`done`/`error`; the frontend buffers chunks via `requestAnimationFrame`.
- AI text size and the active provider/model selection are user-managed in `SettingsPanel.tsx` (AI tab). `buildChatRequest` no longer picks a model; it only shapes context + history.
- AI context window is user-configurable as 5, 20, or 40 recent messages. The frontend decides how many messages to send; the backend should not silently reduce that window again.
- Auto summarization keeps old chat turns as hidden `ConversationMemory`; do not render that summary as a chat message or ingest it directly into Reading Memory.
- Chapter context is smart-trimmed by `src/components/ai/contextWindow.ts`: selected or accumulated text is the focus, and chapter text should only provide nearby background when useful.
- EPUB selected CFI ranges are captured as `selectedCfiRange` and persisted on `ChatMessage.contextCfi` for Reading Memory source tracing; keep this separate from the plain text smart-trimming path.
- AI requests and Reading Memory ingestion should derive reader state from a frozen `ReadingContextSnapshot` in `src/domain/readingSource.ts` instead of re-reading live reader state after a user message is sent.

## Reading Memory
- Reading Memory is a user-selected local Markdown repository laid out as an OKF-compatible LLM Wiki, not an internal database.
- Users choose or open the Reading Memory path from the settings panel.
- Repository structure: a root OKF package (`AGENTS.md`, `index.md`, `log.md`, `shared/` for cross-book concepts), plus one OKF sub-package per book under `<book-slug>/` (each with `AGENTS.md`, `index.md`, `chapters/ concepts/ claims/ questions/ sources/`). Legacy flat directories (`books/`, `concepts/`, `claims/`, `questions/`) are kept for backward compatibility.
- CReader uses AI review before Reading Memory writes. When the AI decides a turn is durable, CReader appends a source-grounded Markdown page into the current book's sub-package (`<book-slug>/<target_dir>/`, where the AI's `target_dir` ∈ books/concepts/claims/questions maps to the matching book sub-package directory), then appends a write event (including `book_slug`, `package_path`) to `.reading-memory/ingestion-log.jsonl`.
- Every note starts with OKF frontmatter: a non-empty `type` (Concept / Claim / OpenQuestions / ChapterNote), `source_refs`, `chapter_refs`, `tags`, `status: inbox`, plus book/chapter/CFI/progress traceability.
- Reading Memory ingestion is intentionally selective: skip ordinary summaries, translations, meta prompts, socratic coaching interactions, short follow-up turns, and repeated explanations unless the user explicitly asks to save them.
- Keep automatic ingestion source-grounded: include book title, author, progress, CFI when available, selected text or question, and the AI answer.
- Reader-flow writes should be append-first and path-restricted to the book sub-package (or repository root) — slugs are sanitized; never let AI-selected paths escape the repository or overwrite arbitrary files.
- External lint agents may organize the full Reading Memory repository by merging duplicates across packages, improving links, and cleaning low-value direct writes.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `lima1217/creader`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-role triage vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain-doc layout. See `docs/agents/domain.md`.

<!-- ASTRYX:START -->
Astryx v0.1.2 · 148 components
CLI: run every command as `npx astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — discover, don't guess. Before writing UI:
1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

RULES:
- No <div> — components do all layout/spacing. Full page → AppShell; sidebar nav → SideNav.
- Custom styling: component props first; else style/className with tokens — var(--color-*|--spacing-*|--radius-*). No raw hex/px. (No StyleX/Tailwind compiler here — don't use xstyle/utility classes.)
- Tokens for every value (`astryx docs tokens`). Brand/accent via `astryx theme` — never override --color-* in :root.

MORE CLI:
  search "<query>"   find any component / hook / doc / template / block
  component --list   148 components by category
  template --list    page + block recipes
  docs <topic>       color, elevation, icons, illustrations, migration, motion, principles, shape, spacing, styling, theme, tokens, typography
  swizzle <Name>     eject component source (--gap reports why)
  upgrade --apply    run after any @astryxdesign/core bump
<!-- ASTRYX:END -->
