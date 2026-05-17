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
- Keep provider, model, Reading Memory, and quick prompt management in the settings panel instead of adding persistent configuration controls back into the AI panel.
- `SettingsPanel.tsx` groups controls under three primary tabs: `AI`, `Reading Memory`, and `快捷提示词`; keep new settings inside the matching tab instead of adding another top-level section.
- The AI panel should stay focused on reading-context conversation: header, message stream, quick prompt buttons, and input.
- Quick prompts are persisted by `src/components/ai/quickActions.tsx`; the AI panel shows up to six direct prompt buttons and moves overflow into the more menu.
- The AI input intentionally uses an empty placeholder for a quieter reading surface.
- Hermes is a supported provider. The backend should prefer `/Users/lima/.hermes/hermes-agent/venv/bin/python /Users/lima/.hermes/hermes-agent/hermes -z <prompt>` when available, falling back to a `hermes` command on `PATH`.
- Hermes model override and AI text size are user settings. Keep these controls in `SettingsPanel.tsx`, and pass the Hermes model through the regular chat request `model` field.
- AI context window is user-configurable as 5, 20, or 40 recent messages. The frontend decides how many messages to send; the backend should not silently reduce that window again.
- Auto summarization keeps old chat turns as hidden `ConversationMemory`; do not render that summary as a chat message or ingest it directly into Reading Memory.
- Chapter context is smart-trimmed by `src/components/ai/contextWindow.ts`: selected or accumulated text is the focus, and chapter text should only provide nearby background when useful.
- EPUB selected CFI ranges are captured as `selectedCfiRange` and persisted on `ChatMessage.contextCfi` for Reading Memory source tracing; keep this separate from the plain text smart-trimming path.
- AI requests and Reading Memory ingestion should derive reader state from a frozen `ReadingContextSnapshot` in `src/domain/readingSource.ts` instead of re-reading live reader state after a user message is sent.

## Reading Memory
- Reading Memory is a user-selected local Markdown repository, not an internal database.
- Users choose or open the Reading Memory path from the settings panel.
- CReader uses AI review before Reading Memory writes. When the AI decides a turn is durable, CReader may directly create or append source-grounded Markdown pages under `books/`, `concepts/`, `questions/`, or `claims/`, then append write events to `.reading-memory/ingestion-log.jsonl`.
- Reading Memory ingestion is intentionally selective: skip ordinary summaries, translations, meta prompts, socratic coaching interactions, short follow-up turns, and repeated explanations unless the user explicitly asks to save them.
- Keep automatic ingestion source-grounded: include book title, author, progress, CFI when available, selected text or question, and the AI answer.
- Reader-flow writes should be append-first and path-restricted to the allowed Reading Memory directories. Do not let AI-selected paths escape the repository or overwrite arbitrary files.
- External lint agents may organize the full Reading Memory repository by merging duplicates, improving links, and cleaning low-value direct writes.
