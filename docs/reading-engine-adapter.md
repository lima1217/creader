# Reading Engine Adapter

Issues: #14, #35, #86, #87, #89, #90, #91, #93, #95

## Adapter Shape

CReader reads EPUBs through a small adapter contract in `src/services/reader/readingEngine.ts`.
The single supported engine is `foliate-js`, hidden behind the CReader-facing adapter surface:

- navigation: `display`, `prev`, `next`, TOC href navigation, `goToChapterStart` / `goToChapterEnd`
- progress: `relocate` events with CFI and percentage, plus whole-book fraction and section fractions
- selection: selected text plus best available EPUB CFI range
- theme: reader font stack, per-section typography (CJK indent / line height), foreground, background, and link styles injected per section document
- layout: fixed `flow=scrolled` applied through `setLayout` on first open and on every settings change

The adapter exposes a `supports` capability object; the current shape is `{ navigation, selection, progress, theme, layout, cfi: 'epub-cfi' }`. UI code reads `supports.layout` rather than sniffing the engine.

Unsupported books fail explicitly through the existing reader error surface. CReader does not silently switch engines and does not execute scripted EPUB content.

## Layout and Continuous Scroll (ADR-0021)

Reading layout is fixed to `flow=scrolled` with the shared line measure (`EPUB_MAX_INLINE_SIZE`, 760px) and animated page transitions. `DEFAULT_READING_LAYOUT` is the single constant both first-open and settings-sync re-apply, so the engine never drifts from it. Layout is **not** a user setting and there is no `flow` option in settings.

Whole-book continuous scroll feel is delivered without a custom renderer, in three parts:

- **In-section scroll:** foliate's native `flow=scrolled` overflow.
- **Cross-chapter advance (Scrolled Boundary Bridge):** when the reader reaches a section boundary, the adapter arms a boundary turn that accumulates scroll intent and then drives `view.next()` / `view.prev()`, preloading the adjacent chapter to reduce the seam feel. The arm state surfaces to the chrome through a `BoundaryArmDirection` plus a 0–1 progress value rendered by `BoundaryArmIndicator`.
- **Whole-book position sense:** the app-drawn Whole-Book Progress Bar reads whole-book fraction, draws chapter tick marks from `getSectionFractions`, and seeks via `seekToFraction`. The native scrollbar only reflects the current chapter, so whole-book position depends on this surface.

New capabilities land on the adapter contract, never on direct foliate attribute writes:

- `ReadingEngineRendition.setLayout(opts: ReadingLayoutOptions)` — apply the fixed layout.
- `ReadingEngineRendition.seekToFraction(fraction)` — jump to a whole-book fraction (progress bar drag).
- `ReadingEngineRendition.getSectionFractions()` — per-section start fractions for progress bar tick marks.
- `ReadingEngineRendition.goToChapterStart()` / `goToChapterEnd()` — chapter-edge navigation.

## foliate-js Validation

The foliate adapter opens a local EPUB `File` created from the Tauri file bytes and renders a `foliate-view` custom element inside the existing reader container. It maps foliate `relocate` events to the same location events consumed by CReader progress tracking.

Validated by implementation:

- Basic EPUB open path: `foliateEngineAdapter.open`
- Chapter/spine navigation: `display`, `prev`, `next`, and TOC hrefs are passed to foliate `goTo`
- Text selection: foliate content document selection is bridged into the existing `selected` event contract with foliate-generated EPUB CFI
- Progress: foliate location fraction is mapped to CReader percentage; whole-book fraction and section fractions back the progress bar
- Theme: existing reader theme styles are injected into loaded foliate section documents; CFI range tracing for selections stays separate from plain text context
- Layout: `flow=scrolled` applied via `setLayout`; boundary advance and adjacent prefetch verified against real chapter seams

## Unsupported Behavior

- Scripted EPUB execution is not supported.
- There is no safe-mode or compatibility fallback prompt.
- Whole-book search is not supported (ADR-0018).
- Reading progress uses foliate's reported location fraction rather than cached generated locations.
- The old epubjs generated-location IndexedDB cache is migration-only data. Dexie v7 deletes the `locations` object store; new code should not read or write it.

## Migration Outcome

foliate-js is now the only Reading Engine. Names that refer to the EPUB format remain in place, but adapter contracts should not model an alternate runtime engine.
