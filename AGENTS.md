# Agent Guide

## Start Here

- Read `CONTEXT.md` for project vocabulary before naming concepts, tests, issues, or ADRs.
- For issue work, fetch the live GitHub issue first. Use `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`; do not infer tracker state from stale local notes.
- Preserve unrelated local changes. Stage only files required by the task, especially when release artifacts, Astryx metadata, or docs are already dirty.
- Use `README.md` for the human-facing project summary; keep this file focused on agent execution rules.

## Project Map

- `src/components/`: reader UI, sidebar, toolbar, settings, selection controls, and AI panel.
- `src/components/ai/`: AI message rendering, stream buffering helpers, conversation memory, context windows, and quick prompts.
- `src/components/reader/`: EPUB selection, progress, keyboard, theme, lifecycle, and reader hooks.
- `src/domain/`: pure AI request, Reading Context Snapshot, context trimming, and Reading Memory Markdown logic.
- `src/services/`: IndexedDB, local storage, import/cover services, Reading Memory bridge, and reading engines.
- `src-tauri/`: Tauri shell, Rust commands, file boundaries, AI provider storage, native search, and Reading Memory writes.
- `releases/`: packaged artifacts. Do not edit unless the task is packaging or release publishing.

## Verification

- Use `npm run typecheck` after TypeScript or React changes.
- Use `npm run test` when touching domain logic, services, hooks, stores, or command call shapes.
- Use `npm run build` after broad frontend or Tauri-facing changes.
- Use `npm run check` as the handoff gate for broad changes.
- For Rust-only command or search-index changes, also run the focused Rust tests from `src-tauri/` when practical.

## Boundaries

- Keep UI work in `src/components/` unless shared state, services, or styling must move with it.
- Keep native file, provider, library, and platform behavior in `src-tauri/`.
- When a Tauri command signature changes, update every frontend `invoke` call in the same patch.
- Extend existing CSS/component selectors before introducing a parallel styling system.
- Generated release binaries are immutable outside packaging tasks.

## AI

- Keep the AI panel a reading conversation surface: message stream, quick prompt buttons, and input. Put provider/model, AI text size, context window, Reading Memory path, and quick prompt management in `SettingsPanel.tsx`.
- Settings has three top-level tabs: `AI`, `Reading Memory`, and `快捷提示词`. Add new settings inside the matching tab.
- Quick prompts are persisted by `src/components/ai/quickActions.tsx`; show up to six direct buttons in the AI panel and put overflow in the more menu.
- The input placeholder is intentionally empty.
- Chat requests carry prompt, frozen reading context, conversation summary, and recent history only. Do not add provider/model fields to `buildChatRequest`.
- The active OpenAI-compatible provider is resolved by the backend from `ai_providers.json` plus `ai_keys.env` in the app config dir. API keys never return to the UI or enter the repo.
- Streaming uses Tauri `Channel<StreamEvent>` with `started`, `chunk`, `done`, and `error`. Keep frontend chunk buffering on the `requestAnimationFrame` path.
- The Rust AI path uses `async-openai` first, with the compatibility SSE parser as fallback for providers the typed client cannot parse.
- Auto summarization is hidden `ConversationMemory`; never render it as a chat message or ingest it directly into Reading Memory.
- AI requests and Reading Memory ingestion must use the frozen `ReadingContextSnapshot` from `src/domain/readingSource.ts`, not live reader state after send.
- Keep EPUB CFI range tracing separate from plain text context: `selectedCfiRange` becomes `ChatMessage.contextCfi`.

## Reading Memory

- Reading Memory is a user-selected OKF-compatible Markdown repository, not an internal database.
- Users choose and open its path from Settings, not the AI panel.
- Current-book writes go into the sanitized book sub-package (`books/<book-slug>/...`); legacy flat directories remain compatibility paths only.
- CReader writes only after AI review decides a turn is durable. Skip ordinary summaries, translations, meta prompts, socratic coaching, short follow-ups, and repeated explanations unless the user explicitly asks to save.
- Notes must be source-grounded: include book title, author, chapter, progress, CFI when available, selected text or question, and AI answer.
- TypeScript owns Markdown rendering/rewrite through unified/remark/YAML in `src/domain/readingMemoryMarkdown.ts`.
- Rust owns the write boundary: validate repository paths, restrict target directories, write files, and append `.reading-memory/ingestion-log.jsonl`.
- Never let AI-selected paths escape the repository or overwrite arbitrary files.

## Reading Engine

- Use `src/services/reader/readingEngine.ts` as the adapter boundary. `foliate-js` is preferred; `epubjs` stays as fallback.
- Search index data is rebuildable derived data. Do not treat it as the source of truth for book content, AI context, or Reading Memory evidence.
- Search Locators may be precise CFI or coarser href/spine locations; preserve that tolerance in UI and command contracts.

## Astryx UI

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
