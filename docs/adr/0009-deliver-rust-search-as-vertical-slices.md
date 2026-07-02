# Deliver Rust Search as Vertical Slices

CReader will move whole-book search into Rust through end-to-end vertical slices rather than a broad layer-by-layer rewrite. The first slice indexes and searches imported EPUB files through Tauri commands, with index status, retry, invalidation, Chinese segmentation, UI states, and frontend fallback removal delivered in the same track.
