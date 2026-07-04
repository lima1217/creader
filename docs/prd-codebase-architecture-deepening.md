# PRD: CReader Codebase Architecture Deepening

## Status

Draft for architecture planning. No implementation is authorized by this PRD yet.

## Summary

CReader is now past the first wave of Reading Engine, Search Index, AI Provider, and Reading Memory migrations. The next code optimization should not be another broad feature rewrite. It should deepen the modules that already carry product-critical behavior, so future changes have better locality, tests cross the same interface callers use, and agents can navigate the codebase without bouncing through many shallow files.

The first recommended track is to create a deeper App Lifecycle module around startup, persistence, hydration, import, and quiet rebuild work. Follow-up tracks should deepen Reading Chrome orchestration and split the native Rust local modules behind the existing Tauri command interface.

## Current Evidence

- `src/App.tsx` is 461 lines and owns theme application, localStorage persistence, cover migration, path validation, Dexie chat hydration, legacy chat migration, file import, drag/drop, search-index rebuild kickoff, lazy panel loading, and app layout.
- `src/stores/libraryStore.ts` owns library state while also reaching into progress state, cover storage, dynamic Tauri invoke, search-index summary updates, and module-level snapshot mirrors for startup race safety.
- `src/components/EPUBReader.tsx` is 572 lines and renders Reading Chrome while also orchestrating Reading Engine lifecycle, progress tracking, selection, TOC state, search overlay, file relocation, chapter actions, and AI-panel triggers.
- `src-tauri/src/lib.rs` is 2489 lines and mixes AI Provider storage, AI streaming, Conversation Memory summarization, Reading Memory review/write, book file validation/import/delete, search command adapters, prompt construction, command registration, and tests.
- The repo already has ADRs that must remain stable: Search Index is derived data, AI and Reading Memory use the frozen Reading Context Snapshot, TypeScript owns Markdown rendering/rewrite, Rust owns the write safety boundary, foliate-js is the only Reading Engine, and Astryx owns Reading Chrome UI leaves where it fits.

## Problem

Several modules are shallow in the architectural sense: callers and tests must know nearly as much about ordering, persistence, migration, and side effects as the implementation does. This reduces depth.

The most expensive symptom is low locality. Startup behavior is spread across React effects, store internals, storage modules, and native commands. Reader behavior is split between `EPUBReader.tsx`, hooks, stores, the Reading Engine Adapter, and AI state. Native behavior is grouped by file location rather than by durable domain modules. When a future issue touches import, restore, progress, Reading Memory, or AI streaming, the maintainer must inspect many seams before knowing where the change belongs.

## Goals

1. Increase module depth around startup and persisted app state, so `App.tsx` becomes mostly composition and delegates lifecycle behavior behind a small interface.
2. Improve locality for Reading Chrome orchestration without revisiting the foliate-only Reading Engine decision or the Astryx migration ADR.
3. Split Rust local behavior into domain modules while preserving the existing Tauri command interface and frontend invoke call shapes.
4. Keep tests aligned with interfaces: callers and tests should exercise the same seam instead of testing private helper fragments or entire render trees.
5. Preserve user-visible behavior: reading flow, AI streaming, Reading Memory writes, search-index states, import behavior, and existing settings must not regress.

## Non-Goals

- Do not add a second Reading Engine adapter. `foliate-js` remains the only Reading Engine.
- Do not move AI or Reading Memory evidence sourcing to the Search Index.
- Do not change AI request shape by adding provider or model fields to `buildChatRequest`.
- Do not redesign Reading Chrome visually; this is architecture work, not an Astryx restyle.
- Do not replace localStorage, Dexie, or Zustand as a prerequisite. Storage migration can be a later vertical slice.
- Do not move TypeScript Markdown rendering into Rust or allow AI-selected paths to cross the Reading Memory write safety boundary.

## Users

The primary user is the future maintainer or coding agent working on CReader. They need to confidently change reading, AI, memory, import, and startup behavior without rediscovering every historical migration rule.

The product user benefits indirectly: fewer regressions in quiet reading sessions, faster issue delivery, and safer changes to AI and Reading Memory.

## Proposed Workstreams

### 1. App Lifecycle Module

Recommendation strength: Strong.

Files involved:

- `src/App.tsx`
- `src/hooks/useDebouncedPersist.ts`
- `src/services/LocalStore.ts`
- `src/services/ChatStore.ts`
- `src/services/CoverStore.ts`
- `src/services/BookPathValidator.ts`
- `src/services/BookImportService.ts`
- `src/services/reader/searchIndex.ts`
- `src/stores/libraryStore.ts`
- `src/stores/progressStore.ts`
- `src/stores/aiStore.ts`

Problem:

`App.tsx` currently acts as a lifecycle script with JSX at the bottom. The interface is wide because callers and tests must understand idle scheduling, cancellation, persistence timing, latest-state snapshots, legacy migrations, path validation, import deduplication, and search-index rebuild side effects. The deletion test says this module is not disposable: deleting it would scatter the same complexity across stores and surfaces.

Solution:

Create a deeper App Lifecycle module that owns startup tasks, persisted-state hydration, legacy migration, import orchestration, and quiet background rebuilds. `App.tsx` should keep layout composition, lazy panels, and top-level providers. Stores should expose state transitions, while lifecycle side effects live behind the lifecycle module instead of being split between stores and React effects.

Benefits:

- Better locality: startup, import, and hydration changes concentrate in one module.
- Better leverage: every future import or startup issue uses the same tested lifecycle interface.
- Better testability: lifecycle tests can drive startup/import scenarios without rendering the whole app.
- Lower AI navigation cost: agents can inspect one module for app boot behavior instead of chasing effects and store side effects.

Acceptance criteria:

- `App.tsx` no longer owns cover migration, path validation, chat hydration, or import/index orchestration directly.
- Legacy chat migration and conversation-memory hydration remain behaviorally identical.
- Import still deduplicates paths, adds the book, and starts Search Index rebuild as derived data.
- Progress persistence and library persistence retain their current debounce behavior.
- Tests cover startup hydration, legacy chat migration, cover migration, path validation race safety, import dedupe, import failure notice, and quiet Search Index status updates.
- `npm run typecheck` and `npm run test` pass for the slice; `npm run check` passes before broad handoff.

### 2. Reading Chrome Session Module

Recommendation strength: Worth exploring.

Files involved:

- `src/components/EPUBReader.tsx`
- `src/components/reader/useEpubBookLifecycle.ts`
- `src/components/reader/useEpubProgressTracking.ts`
- `src/components/reader/useEpubSelectionTracking.ts`
- `src/components/reader/useEpubSearch.ts`
- `src/components/reader/readerNavigation.ts`
- `src/components/reader/SelectionToolbar.tsx`
- `src/services/reader/readingEngine.ts`
- `src/services/reader/foliateEngine.ts`

Problem:

`EPUBReader.tsx` currently mixes rendering with Reading Engine orchestration. The hooks help, but the reader file still knows too much about search state, selection toolbar state, TOC navigation, chapter actions, relocation, progress, AI triggers, and engine refs. The seam is blurry: some behavior belongs to the Reading Engine Adapter, some to Reading Chrome, and some to AI selection flow.

Solution:

Introduce a Reading Chrome Session module that owns orchestration state for the current book: engine instance, TOC state, search workflow, selection workflow, progress updates, relocation, and chapter actions. `EPUBReader.tsx` should render Reading Chrome from that session state and dispatch user intentions back to it. The Reading Engine Adapter remains the adapter around foliate and does not become a multi-engine abstraction.

Benefits:

- Better locality for reader bugs: navigation, search, selection, and progress interactions live in one reader session module.
- Better leverage for tests: session tests can cover workflows without rendering all Reading Chrome markup.
- Preserves ADR 0011: Astryx can still own UI leaves while the positioning shell and engine-owned content remain custom where required.

Acceptance criteria:

- No new Reading Engine implementation or scripted EPUB support.
- Search Locator tolerance remains: precise CFI when available, href/spine fallback when not.
- Reading Context Snapshot still freezes selected text, CFI, accumulated texts, progress, and chapter content at send time.
- Selection Coordinate behavior remains coordinate-based, not DOM-anchor-based.
- Tests cover TOC navigation, search panel state, selection add/ask/close behavior, chapter action behavior, relocation success/failure, and progress update routing.

### 3. Native Local Modules

Recommendation strength: Strong, after App Lifecycle.

Files involved:

- `src-tauri/src/lib.rs`
- `src-tauri/src/search_index.rs`
- future Rust modules under `src-tauri/src/`

Problem:

`src-tauri/src/lib.rs` has become a large native module with many unrelated local responsibilities. It still exposes a useful Tauri command interface, but the implementation lacks locality: AI Provider storage, AI streaming, prompts, Reading Memory repository safety, book files, and command registration all live together.

Solution:

Split Rust implementation into native local modules by domain while preserving the current Tauri command names and frontend invoke call shapes. Good candidate modules are AI Provider, AI Chat, Reading Memory repository/write safety, Book Files, and Command Registration. `search_index.rs` can remain its own deep module unless new evidence says otherwise.

Benefits:

- Better locality for native failures and tests.
- Better leverage from stable Tauri command interfaces.
- Lower risk when changing AI Provider behavior because Reading Memory and book-file safety code are not adjacent implementation noise.

Acceptance criteria:

- Existing command names remain stable.
- API keys still never return to the UI.
- `async-openai` remains the first typed path with compatibility SSE fallback.
- Reading Memory write restrictions remain at the Rust write boundary.
- Rust tests remain with the module that owns the behavior.
- `cargo test` from `src-tauri/` passes after native slices; `npm run check` passes before broad handoff.

### 4. Store Side-Effect Cleanup

Recommendation strength: Worth exploring.

Files involved:

- `src/stores/libraryStore.ts`
- `src/stores/progressStore.ts`
- `src/stores/aiStore.ts`
- `src/services/ChatStore.ts`
- `src/services/CoverStore.ts`

Problem:

Stores currently expose state but also trigger persistence, cover deletion, progress coupling, and native file deletion. This makes the store interface wider than the state transitions it represents. Some side effects are real business behavior, but their current placement makes tests and callers learn store internals.

Solution:

After the App Lifecycle module exists, move cross-store and native side effects into lifecycle/application modules. Stores should remain the in-memory state modules. Side effects should cross explicit seams owned by lifecycle or native adapters.

Benefits:

- Better locality for persistence and deletion behavior.
- Cleaner tests for pure state transitions.
- Fewer hidden side effects when future Reading Chrome or Sidebar changes call store mutators.

Acceptance criteria:

- Removing a book still clears progress, revokes cover URL, deletes stored cover, and requests native file deletion when appropriate.
- Opening a book still bumps `lastReadAt` and merges stored progress.
- Chat writes still persist to Dexie with the same trimming behavior.
- Store tests distinguish pure state transitions from lifecycle side-effect tests.

## Recommended Sequencing

1. App Lifecycle module test scaffold on current behavior.
2. Move startup hydration and legacy migrations behind the App Lifecycle module.
3. Move import and quiet Search Index rebuild orchestration behind the App Lifecycle module.
4. Move path validation and cover migration behind the App Lifecycle module.
5. Review whether store side effects can now be reduced safely.
6. Deepen Reading Chrome Session after lifecycle behavior is stable.
7. Split native Rust local modules after frontend lifecycle churn settles.

## Risks

- A broad refactor can accidentally change persisted data timing. Mitigation: tests first on current behavior and one vertical slice at a time.
- Splitting stores too early can hide necessary coupling between library and progress. Mitigation: move lifecycle orchestration first, then apply the deletion test to store methods.
- Reading Chrome refactoring can regress selection and CFI capture. Mitigation: preserve the frozen Reading Context Snapshot tests and add session workflow tests before markup changes.
- Rust module splitting can become file shuffling without depth. Mitigation: keep command interface stable and move only behavior that improves locality.

## Verification Plan

- Documentation-only PRD: `npm run typecheck` is enough to confirm the current code baseline remains compilable.
- App Lifecycle slices: `npm run typecheck`, focused Vitest coverage for lifecycle behavior, then `npm run test`.
- Reading Chrome slices: `npm run typecheck`, existing reader hook tests, new session workflow tests, then `npm run test`.
- Native slices: focused `cargo test` from `src-tauri/`, then `npm run check` before handoff.

## Open Questions

- Should the App Lifecycle module be introduced as a React hook, a framework-neutral TypeScript module, or a small pair of modules separating scheduling from behavior? This should be grilled before implementation.
- Should book import become part of App Lifecycle or a dedicated Library Intake module? The first slice should compare both for depth and locality.
- Should native command registration stay in `lib.rs` as the only public native interface while implementations move out, or should registration move into a dedicated module too?

## Top Recommendation

Start with the App Lifecycle module. It has the strongest deletion-test signal, the broadest leverage, and the least risk of contradicting existing ADRs. It also prepares the ground for the store cleanup and makes later Reading Chrome work less likely to collide with startup, hydration, and import behavior.
