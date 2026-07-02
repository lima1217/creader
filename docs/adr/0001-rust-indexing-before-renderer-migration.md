# Put Whole-Book Search in Rust Before Migrating the Reading Engine

CReader will first move whole-book extraction and search indexing into the Rust side, using a local full-text index so the WebView does not need to load or scan entire books for search. The foliate-js reading engine migration remains a separate later decision because combining renderer replacement with indexing, state, storage, and AI-client rewrites would blur the performance goal and make regressions harder to isolate.

