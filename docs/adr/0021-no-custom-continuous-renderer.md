# No Custom Continuous Renderer

**Status: Accepted**

CReader will not build a custom continuous renderer. Instead, it will deliver the *feel* of whole-book continuous scrolling using foliate's `flow=scrolled` with boundary auto-advance, adjacent chapter preloading, and an app-drawn whole-book progress bar.

## Context

The reader needs to deliver a "whole-book continuous scroll" experience. The most literal implementation would load all sections into a single scrollable container, forming one long document from start to finish.

However, foliate-js's paginator only supports `flow=scrolled` for the *current* section — when the reader scrolls to the section boundary, a `scrollNext` / `scrollPrev` event triggers `turnPage` to load the next/previous section and anchor to the top/bottom. The foliate README explicitly states "no support for continuous scrolling."

Building a true whole-book continuous renderer would mean reimplementing section mounting/unmounting, virtualization, CFI mapping, cross-section selection, and theme injection — a second engine inside the Reading Engine Adapter, violating ADR-0012's single-engine boundary and breaking existing assumptions around CFI, selection context, and per-document theme injection.

## Decision

| Requirement | Approach |
|---|---|
| Smooth in-chapter scroll | foliate `flow=scrolled` native overflow scroll |
| Seamless cross-chapter advance | Drive `view.next()` / `view.prev()` at section boundary; preload adjacent chapters to reduce seam feel |
| Whole-book position sense | App-drawn **whole-book progress bar** (whole-book fraction), replacing the native scrollbar which only reflects the current chapter |
| Position jump | Whole-book progress bar drag → `view.goToFraction(frac)` |

## Rationale

1. **Consistent with ADR-0012**: The single-engine boundary is established direction. A custom continuous renderer equals a second rendering/CFI/selection system inside the adapter boundary.
2. **Protects CFI and selection**: CFI computation and selection listeners are per-section (via `load` event). Cross-visible-section selection/CFI behavior is complex and high-regression-risk, threatening AI selection context and Reading Memory anchor points.
3. **Protects theme injection**: foliate section documents do not inherit host `:root`; themes are injected via per-document `<style>` (ADR-0011/0017). A custom renderer would need to redo this injection path.
4. **Cost exceeds benefit**: `flow=scrolled` + boundary chapter change + whole-book progress bar already delivers a usable continuous scroll feel. The only missing piece is "invisible chapter seams," which adjacent chapter prefetch can mitigate.

## Consequences

- **Chapter seam**: A section switch occurs at chapter boundaries. The native scrollbar reflects only the current chapter; whole-book position uses the app-drawn progress bar (document in release note).
- **New capabilities land on the adapter contract**: `ReadingEngineRendition` gains `setLayout` / `seekToFraction` / `getSectionFractions`; `supports.layout` flag. UI interacts only with the contract, never directly with `setAttribute`.
- **Whole-book progress bar becomes a first-class citizen**: Progress, tick marks, and jumping all depend on it; the `fraction` semantics in `relocate` detail (in-chapter vs whole-book) must be verified before use.

## Non-Goals

- No custom renderer or second engine outside the adapter boundary.
- No section virtualization / whole-book DOM merging for a "one long document."
- No `flow` setting in user settings — layout is fixed `flow=scrolled`.

## Relationship to Other ADRs

- **ADR-0012** (foliate as the only Reading Engine) — this ADR operates within that boundary; a custom continuous renderer would violate it.
- **ADR-0011 / ADR-0017** (Paper Workspace palette and book-body single source of truth) — theme injection assumptions remain unchanged.
