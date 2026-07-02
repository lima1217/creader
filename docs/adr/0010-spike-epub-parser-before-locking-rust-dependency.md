# Spike the EPUB Parser Before Locking the Rust Dependency

CReader will not lock the Rust EPUB parser dependency before a small parser spike. The first candidate is rbook, with epub as a fallback, and the dependency is accepted only if it can extract metadata, spine order, stable chapter locators, and plain chapter text from real EPUB samples without requiring precise CFI generation.

## Spike Result

`rbook` is not accepted as a runtime dependency for the first Rust Search Index slice. The implemented path uses ZIP + XML extraction directly, which is enough for metadata, OPF spine order, TOC titles, chapter href locators, and plain XHTML text. This keeps the first search index rebuildable and parser-specific behavior small. `rbook` can be reconsidered later if direct extraction stops covering real EPUB samples.
