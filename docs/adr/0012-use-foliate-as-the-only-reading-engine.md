# Use foliate-js as the Only Reading Engine

CReader will use foliate-js as its only Reading Engine and remove the epubjs fallback path. This makes unsupported books fail explicitly instead of silently changing engines, and it also means CReader no longer supports executing scripted EPUB content through a safe-mode/fallback renderer.

CReader will keep the Reading Engine Adapter as a narrow boundary around foliate's custom element, event bridge, CFI mapping, selection coordinates, and theme injection. The adapter is no longer a multi-engine abstraction.

The user-facing safe-mode and "allow EPUB scripts" controls are removed with the fallback path. Script execution is not a configurable reader capability.

The epubjs generated-location cache is removed with the fallback path. Reading progress uses foliate's reported location fraction instead of maintaining a second progress source.

Names that describe the EPUB format may stay in place, but epubjs-specific types, adapters, tests, and settings should be removed or renamed so the remaining adapter boundary reads as foliate-only.

When foliate cannot open a book, CReader should show a clear unsupported/open-failed message through the existing error surface and keep the original foliate error in logs for diagnosis.
