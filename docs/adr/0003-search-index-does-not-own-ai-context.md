# Keep Search Indexes Separate From AI Reading Context

**Status: superseded by ADR-0018 for search-index scope.** The AI rule below remains valid: AI and Reading Memory must not source evidence from a search index.

The first Rust full-text index is only a search surface, not the source of AI or Reading Memory context. AI requests and Reading Memory ingestion continue to use the frozen reading context snapshot so source traceability, selections, progress, and CFI references are not accidentally replaced by index excerpts with weaker evidence boundaries.

