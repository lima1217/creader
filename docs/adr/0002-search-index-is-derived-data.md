# Treat Search Indexes as Rebuildable Derived Data

**Status: superseded by ADR-0018.** Whole-book search and Rust indexing were removed.

CReader imports a readable book even when full-text indexing fails, because the copied EPUB and library record are the source of truth while the search index is rebuildable derived data. Indexing exposes missing, pending, ready, failed, and stale states with retry/rebuild support; whole-book search depends on the Rust index instead of a WebView scanning fallback.
