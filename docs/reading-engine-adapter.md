# Reading Engine Adapter Spike

Issue: #14

## Adapter Shape

CReader reads EPUBs through a small adapter contract in `src/services/reader/readingEngine.ts`.
Both engines expose the same reader-facing surface:

- navigation: `display`, `prev`, `next`, TOC href navigation
- progress: relocated/locationChanged events with CFI and percentage
- selection: selected text plus best available EPUB CFI range
- Search Locator navigation: search result CFI or href can be passed to `display`
- theme: reader font, line height, foreground, background, and link styles

`foliate-js` is the preferred engine. `epubjs` remains available as the fallback adapter and is used automatically if foliate fails to open a book.

## foliate-js Validation

The foliate adapter opens a local EPUB `File` created from the Tauri file bytes and renders a `foliate-view` custom element inside the existing reader container. It maps foliate `relocate` events to the same location events consumed by CReader progress tracking.

Validated by implementation:

- Basic EPUB open path: `foliateEngineAdapter.open`
- Chapter/spine navigation: `display`, `prev`, `next`, and TOC hrefs are passed to foliate `goTo`
- Text selection: foliate content document selection is bridged into the existing `selected` event contract with foliate-generated EPUB CFI
- Progress: foliate location fraction is mapped to CReader percentage
- Search Locator navigation: existing search result CFI/href is routed through the shared `display` contract
- Theme: existing reader theme styles are injected into loaded foliate section documents

## Parity Gaps

- `foliate-js` does not support scripted EPUB content. CReader keeps epubjs fallback, and the existing "safe mode" affordance remains meaningful for the fallback path.
- Existing cached epubjs generated locations are not reused by foliate. Foliate reports progress from its own section fraction instead.
- The font sanitizer remains epubjs-only because foliate's loader/rendering model differs and does not expose the same epubjs spine hooks.

## Default Migration Outcome

foliate-js is ready to be the preferred default engine with epubjs fallback kept in place. A later cleanup can remove epubjs only after manual validation across a broader EPUB fixture set proves that scripted-content behavior, font edge cases, and progress restore parity are acceptable without fallback.
