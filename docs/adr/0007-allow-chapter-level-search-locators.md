# Allow Chapter-Level Search Locators in Rust Search

**Status: superseded by ADR-0018.** Whole-book search was removed.

Rust search results may initially return a spine item or href plus an excerpt instead of a precise EPUB CFI. This lets CReader move whole-book search out of the WebView without coupling the first index implementation to renderer-specific CFI generation; precise CFI locators can be added later when they are reliable.

## Search Locator Contract

Rust search returns each result with:

- `locator.kind`: `chapter` when the result can only navigate to a spine href, `cfi` when a precise EPUB CFI is available.
- `locator.href`: the normalized EPUB spine href, relative to the EPUB root.
- `locator.spineIndex`: the zero-based spine order.
- `locator.cfi`: optional precise EPUB CFI.
- `sectionTitle`: a TOC title when available, otherwise the OPF spine id.
- `excerpt`: a short plain-text snippet around the query.
- `score`: Tantivy rank score.

The frontend navigates to `locator.cfi || locator.href`. This keeps chapter-level results usable today and leaves precise CFI generation as an additive contract extension.
