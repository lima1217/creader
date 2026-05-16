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
- The AI panel should stay focused on reading-context conversation: header, message stream, quick prompt buttons, and input.
- Quick prompts are persisted by `src/components/ai/quickActions.tsx`; the AI panel shows up to six direct prompt buttons and moves overflow into the more menu.
- The AI input intentionally uses an empty placeholder for a quieter reading surface.

## Reading Memory
- Reading Memory is a user-selected local Markdown repository, not an internal database.
- Users choose or open the Reading Memory path from the settings panel.
- CReader may append automatic inbox notes under `inbox/` and append write events to `.reading-memory/ingestion-log.jsonl`.
- Keep automatic ingestion source-grounded: include book title, author, progress, CFI when available, selected text or question, and the AI answer.
- Do not rewrite promoted wiki pages automatically from the reader flow; external lint agents may organize `inbox/` into `books/`, `concepts/`, `questions/`, and `claims/`.
