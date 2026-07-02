# Keep Search Indexes Separate From AI Reading Context

The first Rust full-text index is only a search surface, not the source of AI or Reading Memory context. AI requests and Reading Memory ingestion continue to use the frozen reading context snapshot so source traceability, selections, progress, and CFI references are not accidentally replaced by index excerpts with weaker evidence boundaries.

