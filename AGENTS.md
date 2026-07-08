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
- `src-tauri/`: Tauri shell, Rust commands, file boundaries, AI provider storage, and Reading Memory writes.
- `releases/`: local staging for macOS `.dmg` bundles before GitHub Releases upload. Binaries are gitignored; see `docs/release.md`. Do not commit `.dmg` files.

## Verification

- Use `npm run typecheck` after TypeScript or React changes.
- Use `npm run test` when touching domain logic, services, hooks, stores, or command call shapes.
- Use `npm run build` after broad frontend or Tauri-facing changes.
- Use `npm run check` as the handoff gate for broad changes.
- For Rust-only command changes, also run the focused Rust tests from `src-tauri/` when practical.

## Boundaries

- Keep UI work in `src/components/` unless shared state, services, or styling must move with it.
- Keep native file, provider, library, and platform behavior in `src-tauri/`.
- When a Tauri command signature changes, update every frontend `invoke` call in the same patch.
- Extend existing CSS/component selectors before introducing a parallel styling system.
- Generated release binaries are immutable outside packaging tasks.

## AI

- Keep the AI panel a reading conversation surface: message stream, quick prompt buttons, and input. Put provider/model, AI text size, context window, Reading Memory path, and quick prompt management in `SettingsPanel.tsx`.
- Settings is the `AI 设置` dialog with three top-level tabs: `AI 设置`, `阅读记忆`, and `快捷提示词`. The dialog does not repeat the title above the tabs. Add new settings inside the matching tab; do not reintroduce a console overview or side navigation.
- Quick prompts are persisted by `src/components/ai/quickActions.tsx`; show up to six direct buttons in the AI panel and put overflow in the more menu.
- The input placeholder is intentionally empty.
- Chat requests carry prompt, frozen reading context, conversation summary, and recent history only. Do not add provider/model fields to `buildChatRequest`.
- The active OpenAI-compatible provider is resolved by the backend from `ai_providers.json` plus `ai_keys.env` in the app config dir. API keys never return to the UI or enter the repo.
- Streaming uses Tauri `Channel<StreamEvent>` with `started`, `chunk`, `done`, and `error`. Keep frontend chunk buffering on the `requestAnimationFrame` path.
- The Rust AI path uses `async-openai` for OpenAI-compatible Chat Completions and stream parsing.
- AI tool calling is orchestrated in Rust inside the `async-openai` path. The frontend may display tool activity, but it does not execute tools or drive the loop.
- Keep the tool loop bounded, using a small maximum round count plus the existing cancellation and timeout behavior.
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

- Use `src/services/reader/readingEngine.ts` as the adapter boundary around the single `foliate-js` Reading Engine. Do not reintroduce an `epubjs` fallback or scripted-EPUB compatibility UI.
- Rust chapter text extraction for AI tools belongs outside the Reading Engine Adapter. Text extraction does not render EPUB content and must not become a second Reading Engine.
- CReader does not ship whole-book search. Do not reintroduce Rust indexing, import-time rebuild, or a reader search panel without an explicit new ADR.

## UI Palette & Theme

- Two themes only: `light` (亮色) and `dark` (暗色). The `Theme` type in `src/types/index.ts` is `'light' | 'dark'`. Sepia/护眼 was retired in Astryx Phase 1; do not reintroduce a third theme or a `sepia` value.
- One warm "Paper Workspace" palette feeds two token systems. Keep them in sync from the same colors; do not fork a second palette.
  - Native CReader chrome consumes CReader's own tokens in `src/index.css` under `[data-theme="light"]` / `[data-theme="dark"]` (`--bg-*`, `--text-*`, `--accent`, `--border-*`, `--success/--warning/--error`, shadows).
  - Astryx components consume `--color-*` tokens defined once in `src/theme/paperTheme.ts` via `defineTheme`, as `[light, dark]` tuples that Astryx compiles to CSS `light-dark()`. Never override `--color-*` in `:root` (Astryx rule) — edit `paperTheme.ts` instead.
- Book-body colors have a single source of truth: `paperBodyPalette` in `src/theme/paperTheme.ts` holds the three book-body colors (background / text / link) per mode. Both the Astryx body tokens (`--color-background-body`, `--color-text-primary`, `--color-accent`) and the reading-engine bridge `src/components/reader/epubTheme.ts` draw from it. The engine bridge injects literal color values (not `var(--color-*)`) because foliate section documents do not inherit the host `:root`. Edit the palette in one place so chrome and book body stay in sync. See ADR-0011 and ADR-0017.
- Layer surfaces by background tone step, not by borders (Epic #72 / issues #68–#71). Semantics: `--bg-primary` (also `--bg-reader` / `--bg-panel`) is the base, `--bg-secondary` is inputs, `--bg-elevated` is cards / popovers / dropdowns / overlays, `--bg-tertiary` is the deepest hover / secondary-button step.
- The tonal direction flips per theme:
  - Dark: raised layers get **brighter** — brightness increases monotonically `--bg-primary` `#1A1B1E` < `--bg-secondary` `#212226` < `--bg-elevated` `#26272B` < `--bg-tertiary` `#2D2E33`. Text is neutral gray (`--text-primary` `#D4D4D4`), no blue cast.
  - Light: raised layers get **darker** — brightness decreases monotonically `--bg-primary` `#FBF9F4` (warm white, base) > `--bg-elevated` `#F4F1E9` > `--bg-secondary` `#EFEBE1` > `--bg-tertiary` `#E7E2D6`. Text is warm near-black (`--text-primary` `#2B2B2B`). The book reading surface is `#F7F3EA` (from `paperBodyPalette`), distinct from the chrome base.
- Borders do not carry layering. `--border-*` are weak (translucent white in dark, translucent near-black in light) and reserved for focus rings, input affordance, and the occasional `--border-soft` hairline separator. Never pair a visible divider border with a tone step for the same layer (no double emphasis).
- Accent stays hue-consistent (blue) across themes but is tuned per theme: light is lower-saturation and deeper so it is not harsh on warm white (`--accent` `#33526E`, ink blue); dark stays vivid (`--accent` `#7EB0E0`, sky blue). Semantic colors (success/warning/error) follow the same "light is deeper/less saturated, dark stays vivid" rule. The dark primary button uses `#1A1B1E` as its on-accent text color.
- Keep the book-body background opaque so foliate's white iframe canvas never shows through in dark mode.
- The A-/number/A+ text-size stepper is shared as `src/components/TextSizeControl.tsx`, used by both the reader toolbar more menu (`fontSize`) and the AI settings panel (`aiTextSize`). Reuse it instead of rebuilding a stepper.

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
