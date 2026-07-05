# Rust Search Indexing Roadmap

**Status: retired.** Whole-book search and the Rust Tantivy index were removed in ADR-0018. This file is kept only as historical context for the earlier optimization track.

## Former Goal

Move whole-book search work out of the WebView and into Rust with Tantivy + Chinese segmentation.

## Why Retired

Import-time indexing caused high CPU use and added native dependencies without matching CReader's lightweight reading + AI focus. See `docs/adr/0018-remove-whole-book-search.md`.
