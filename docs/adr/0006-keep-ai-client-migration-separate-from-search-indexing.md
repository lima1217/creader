# Keep AI Client Migration Separate From Search Indexing

**Status: superseded by ADR-0018 for search-coupling scope.** Keeping AI client migration separate from unrelated tracks remains a useful rule.

CReader may later replace handwritten OpenAI-compatible HTTP streaming with async-openai, but that migration should not be bundled with Rust search indexing. The existing provider, key-storage, and frontend stream-event contract stay stable while search moves out of the WebView; an AI client migration can then focus only on typed requests and stream parsing compatibility.

