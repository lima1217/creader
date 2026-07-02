# Keep Client State and Storage Refactors Out of Search Indexing

Zustand and Dexie are useful cleanup directions for CReader, but they are not prerequisites for moving whole-book search into Rust. The Rust indexing work should land as its own vertical slice first, while IndexedDB cleanup and React Context replacement happen later so search regressions are not mixed with client-state or schema-migration changes.

