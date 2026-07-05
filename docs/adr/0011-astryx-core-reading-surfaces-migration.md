# Migrate Core Reading Surfaces (Sidebar, SelectionToolbar, AIPanel) to Astryx

CReader's Phase 1 introduced Astryx for settings, dialogs, and toasts. The core reading surfaces — `Sidebar.tsx`, `SelectionToolbar.tsx`, `AIPanel.tsx` — still render bespoke JSX. This ADR locks the decisions for migrating them, reached through a design grilling session.

## Decisions

### 1. Scope: chrome-only. The reading body is out of scope as Astryx components.

The book content is rendered by foliate-js inside the host DOM via a custom element hidden behind `ReadingEngineAdapter` (`docs/reading-engine-adapter.md`). Astryx components live in the React tree; they cannot own the engine's rendered content. Therefore "migrating the reader" means the **reader chrome** (toolbar, TOC drawer, search overlay, progress, selection toolbar), never the rendered book body.

Note: the original framing of this decision ("the iframe is the wall") was wrong — foliate-js renders a custom element, not an iframe. The *real* constraint is that the engine renders its own content tree outside Astryx's component ownership, regardless of whether that tree is an iframe or a custom element. The conclusion (chrome-only) is unchanged.

### 2. Validation: tests-first, written before each migration slice.

AIPanel is 800 LOC with a streaming contract, RAF-buffered chunk handling, quick-action overflow, conversation summarization, and Reading Memory ingestion — and currently has zero tests. Replacing untested working JSX invites silent regressions. Every surface gets behavioral contract tests on its *current* implementation first; the migration must keep those tests green.

### 3. Sequencing: Sidebar → SelectionToolbar → AIPanel (ascending difficulty).

- **Sidebar** (604 LOC, 0 `invoke()` calls, pure data/nav) is the lowest-risk surface and establishes the test harness, the Astryx component mapping, and the list/nav/menu patterns that the other two surfaces reuse.
- **SelectionToolbar** (82 LOC, 11 signal/event refs) is small but selection-wired; migrated second with the harness now proven.
- **AIPanel** (800 LOC, streaming + memory) is migrated last, by which point the test patterns are battle-tested.

### 4. Sidebar book list: `List` + `ListItem` with custom rich children.

Astryx's `List`/`ListItem` owns the row interaction model (selection, keyboard nav, ARIA) — the genuinely valuable, hard-to-rebuild part. The dense per-book content (cover, title, author, category badge, CSS-var progress bar, hover-revealed action buttons) stays a custom composition passed as `ListItem` children. `SelectableCard` was rejected: it would force the cover+text+badge+progress+3-actions into its layout slots and fight the hover-reveal and progress-bar patterns.

### 5. Sidebar modals: `Dialog` (Phase 1 precedent).

The three inline custom modals (edit book, add/edit category, assign category) migrate to Astryx `Dialog`/`DialogHeader`, continuing exactly the pattern Phase 1 set with `SettingsPanel` and `AppDialog`.

### 6. Test style: contract-mock, extending the Phase 1 precedent.

Phase 1's `AppDialog.test.tsx` mocks Astryx components as no-op stubs and asserts only on owned behavior (`confirm()` returns a Promise, `notice()` routes to the toast channel) — it never renders Astryx internals. New tests extend this: mock the Astryx components the surface will adopt, render the surface, and assert on store interactions, callback wiring, modal open/close state, and event dispatch. No `@testing-library/react` (not installed; deliberately avoided to not pin Astryx's portal/visual internals). The migration becomes safe because the *contracts* are locked; when `Dialog` replaces a modal the contract test still passes regardless of which component renders it.

### 7. SelectionToolbar: keep the positioning shell custom; migrate only the buttons.

The toolbar is rendered at arbitrary `{x, y}` screen coordinates produced by `epubSelectionListeners.ts` from the reading engine's selection, with manual viewport-flip logic. There is **no React anchor element** — the `ReadingEngineAdapter` emits coordinates, never a DOM node. Astryx's `Popover`/`Tooltip` require a trigger element or `anchorRef`, so they cannot natively own this toolbar. Decision: keep the positioning shell + flip logic + engine boundary as custom JSX (it is genuinely structural, not decoration), and migrate only the inner buttons (`加入选文`, `问 AI`, close) to Astryx `Button`/`IconButton`, plus token-style the hint line. A synthetic invisible anchor + `Popover` (the alternative) was rejected as fragile at engine/viewport edges.

### 8. AIPanel: selective Chat-kit adoption (leaves, not layout).

Astryx ships a `Chat` family including `ChatLayout`/`ChatMessageList`/`ChatMessage`/`ChatComposer`/`ChatSendButton`. Decision:

- **Adopt the leaves**: `ChatMessage` (per-message shell, role semantics, content/metadata/action slots), `ChatComposerInput` + `ChatSendButton` (quiet reading-surface input — the empty placeholder convention from `AGENTS.md` is preserved).
- **Keep custom**: `LayoutPanel` + `List` with custom children for the message list, the scroll handler (`handleMessagesScroll`), the resize handle + RAF-bound width logic, and the quiet empty state.

Rationale: `ChatLayout` "expects to own its scroll context" (per its docs) and ships with built-in auto-scroll, scroll-to-bottom button, and frosted-glass dock. CReader's AIPanel has its own scroll handler, its own resize logic, and a deliberately quiet empty state. Forcing it into `ChatLayout` means either fighting the layout's ownership (via `scrollRef` overrides) or surrendering CReader-specific scroll/resize/quiet-state behavior. Neither is acceptable. Adopting only the conflict-free leaves (message styling, composer styling, send affordance) captures the real design-system value without the ownership collision.

### 9. CSS cleanup: rides with each slice's PR, token-only supplements.

Phase 1's precedent (`SettingsPanel.css`, comments "slice 3 / slice 4 ... Tokens only"): keep the CSS file, prune it to **token-only supplements** (rules Astryx doesn't own, no raw hex/px, `var(--*)` only), and delete rules orphaned by the slice's migration — all in the same PR. Sidebar.css (951 LOC) selectors are unshared (used only in `Sidebar.tsx`), so each slice can safely delete its orphaned rules with no cross-component blast radius. No separate "CSS cleanup PR"; no pre-migration CSS rewrite.

### Resolved sub-decisions (low-ambiguity, documented for completeness)

- **Icon system**: Astryx `Icon` accepts `icon: IconName | ComponentType<SVGProps>`. Local icons are already SVG components. Migration is compositional — use Astryx `Icon` with its semantic name set where a match exists (`close`, `chevronDown`, `check`, `copy`, `search`, `moreHorizontal`, …), and pass the existing local SVG components directly to `Icon`'s `icon` prop otherwise. No icon-library swap, no icon-system rewrite.
- **AIPanel resize handle**: Astryx ships no `Resizer`/`Splitter` *component* (only the `useResizable` hook). The existing `ai-panel-resize-handle` + RAF-bound width logic stays custom, token-styled.

## PR breakdown (5 slices, test-gated)

1. **Sidebar contract tests** on current JSX (no Astryx yet) — establishes the harness + Sidebar behavior lock.
2. **Sidebar header** → Astryx (`IconButton`, `SideNav` header shape) + CSS prune.
3. **Sidebar category nav** → `SideNav`/`SideNavSection`/`SideNavItem` + `MoreMenu` for per-item actions + CSS prune.
4. **Sidebar book list** → `List`/`ListItem` with rich children + `EmptyState` + CSS prune.
5. **Sidebar modals** → `Dialog`/`DialogHeader` (+ three inline modals) + CSS prune.

(SelectionToolbar and AIPanel get their own grilling-confirmed slices after Sidebar ships, following the same per-slice test→migrate→green discipline. AIPanel in particular decomposes into: tests on the streaming contract → chrome leaves (`ChatMessage`/`ChatComposerInput`/`ChatSendButton`) → source-bar/quick-action overflow → empty-state/quiet-placeholder — each its own test-gated slice.)

### AIPanel slices (shipped, #31–#33)

The AIPanel decomposition landed as three test-gated slices, all keeping the #26 streaming/memory/overflow contract green:

- **#31 — message rendering on `ChatMessage`:** each user/assistant/streaming message renders through `ChatMessage` (imported as `AstryxChatMessage` to avoid clashing with the local `ChatMessage` *type*). The source-reference, content bubble, and hover-revealed copy action stay as custom children inside `ChatMessage`'s content slot; the orphaned `display:flex` on `.ai-message` was pruned because `ChatMessage`'s `<article>` now owns the row/column layout.
- **#32 — composer on `ChatComposerInput` + `ChatSendButton`:** `ChatComposerInput` is a `contentEditable` (not a `textarea`), driven via its controlled `value`/`onChange`/`onSubmit`; the per-message Enter-to-submit moved off the local `handleKeyDown` onto `ChatComposerInput`'s built-in `onSubmit`. The empty placeholder (the AGENTS.md quiet-surface rule) is preserved by passing `placeholder=""`. `ChatSendButton` is wired standalone (no `ChatComposer` wrapper) with explicit `isStopShown`/`onSend`/`onStop` and the existing `SendIcon`/`StopIcon`. The contract tests drive the contentEditable by setting `textContent` + an `input` event and find the button by its `Send` aria-label.
- **#33 — chrome polish on tokens:** direct quick-prompt buttons adopt Astryx `Button` (`ghost`/`sm`) and the >6 overflow adopts `MoreMenu` (whose items render in a portal as `[role="menuitem"]`); the source bar, panel shell, resize handle, and quiet empty state stay custom and token-styled. The `.ai-margin-overflow*` / `.ai-stop-btn` / `.ai-panel-input textarea` rules were deleted as orphans.

## Consequences

- The reader body's visual theming remains driven by the engine theme injection path (`epubTheme.ts` and the foliate theme bridge), not Astryx tokens. A future ADR may bridge engine theme tokens to Astryx paper-theme tokens if the book body should *visually* belong to the same system (that is a token-level concern, separate from this component-level migration). *(Realized in [ADR-0017](0017-unify-chrome-and-book-body-from-one-paper-palette.md): the book body now draws from the shared `paperBodyPalette` source.)*
- `@testing-library/react` is deliberately not adopted; the contract-mock style is the project's testing convention for Astryx-touching surfaces.
- No `ChatLayout` adoption means CReader forgoes Astryx's chat a11y/keyboard model in exchange for keeping its scroll/resize/quiet-state behavior. This is the explicit trade.
