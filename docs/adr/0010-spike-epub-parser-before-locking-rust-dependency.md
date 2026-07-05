# Spike the EPUB Parser Before Locking the Rust Dependency

**Status: superseded by ADR-0018 for search-index scope.** The spike conclusion below is historical.

CReader will not lock the Rust EPUB parser dependency before a small parser spike. The first candidate is rbook, with epub as a fallback, and the dependency is accepted only if it can extract metadata, spine order, stable chapter locators, and plain chapter text from real EPUB samples without requiring precise CFI generation.

## Spike Result

`rbook` was not accepted as a runtime dependency for the Rust Search Index slice. The implemented path used ZIP + XML extraction directly. That search-index path has since been removed in ADR-0018.
