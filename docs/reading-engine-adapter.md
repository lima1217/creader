# Reading Engine Adapter

Issues: #14, #35

## Adapter Shape

CReader reads EPUBs through a small adapter contract in `src/services/reader/readingEngine.ts`.
The single supported engine is `foliate-js`, hidden behind the CReader-facing adapter surface:

- navigation: `display`, `prev`, `next`, TOC href navigation
- progress: relocated/locationChanged events with CFI and percentage
- selection: selected text plus best available EPUB CFI range
- Search Locator navigation: search result CFI or href can be passed to `display`
- theme: reader font, line height, foreground, background, and link styles

Unsupported books fail explicitly through the existing reader error surface. CReader does not silently switch engines and does not execute scripted EPUB content.

## foliate-js Validation

The foliate adapter opens a local EPUB `File` created from the Tauri file bytes and renders a `foliate-view` custom element inside the existing reader container. It maps foliate `relocate` events to the same location events consumed by CReader progress tracking.

Validated by implementation:

- Basic EPUB open path: `foliateEngineAdapter.open`
- Chapter/spine navigation: `display`, `prev`, `next`, and TOC hrefs are passed to foliate `goTo`
- Text selection: foliate content document selection is bridged into the existing `selected` event contract with foliate-generated EPUB CFI
- Progress: foliate location fraction is mapped to CReader percentage
- Search Locator navigation: existing search result CFI/href is routed through the shared `display` contract
- Theme: existing reader theme styles are injected into loaded foliate section documents

## Unsupported Behavior

- Scripted EPUB execution is not supported.
- There is no safe-mode or compatibility fallback prompt.
- Reading progress uses foliate's reported location fraction rather than cached generated locations.
- The old epubjs generated-location IndexedDB cache is migration-only data. Dexie v7 deletes the `locations` object store; new code should not read or write it.

## Migration Outcome

foliate-js is now the only Reading Engine. Names that refer to the EPUB format remain in place, but adapter contracts should not model an alternate runtime engine.
