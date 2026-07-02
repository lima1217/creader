# Keep Frontend Search Fallback During Rust Index Rollout

CReader will keep the existing frontend EPUB search path as a temporary fallback while Rust indexing rolls out. Rust search is the normal path, but fallback search protects users when an index is missing, pending, failed, or unavailable; the fallback can be deleted after indexing, rebuild, Chinese and English search, locator navigation, and retry behavior are covered and validated.

Status: superseded by the Rust Search Index implementation. The frontend whole-book fallback has been removed; missing, pending, failed, and stale indexes are now explicit search UI states with rebuild/retry actions.
