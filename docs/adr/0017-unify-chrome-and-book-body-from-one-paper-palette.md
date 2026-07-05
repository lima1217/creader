# Unify Chrome and Book Body from One Paper Palette

Follows: [0011 Migrate Core Reading Surfaces to Astryx](0011-astryx-core-reading-surfaces-migration.md)

ADR-0011 left the reader body's visual theming on the engine injection path and foreshadowed "a future ADR [that] may bridge engine theme tokens to Astryx paper-theme tokens if the book body should visually belong to the same system (a token-level concern, separate from the component-level migration)." This ADR is that decision.

## Decision

CReader has one warm "Paper Workspace" palette with two modes only: `light` (亮色) and `dark` (暗色). Sepia/护眼 was retired in Astryx Phase 1 and is not reintroduced; `Theme` is `'light' | 'dark'`.

The palette feeds two token systems from the same colors:

- Native CReader chrome consumes CReader's own tokens in `src/index.css` (`--bg-*`, `--text-*`, `--accent`, `--border-*`, status, shadows) under `[data-theme="light"]` / `[data-theme="dark"]`.
- Astryx components consume `--color-*` tokens defined once in `src/theme/paperTheme.ts` via `defineTheme`, as `[light, dark]` tuples that Astryx compiles to `light-dark()`.

The three book-body colors (background, text, link) have a single source of truth: `paperBodyPalette` in `src/theme/paperTheme.ts`. Both the Astryx body tokens (`--color-background-body`, `--color-text-primary`, `--color-accent`) and the reading-engine theme bridge (`src/components/reader/epubTheme.ts`) draw from it. The bridge injects literal color values rather than `var(--color-*)` because foliate section documents render in their own DOM and do not inherit the host app's `:root`. The book-body background stays opaque so foliate's white iframe canvas never shows through in dark mode.

Surfaces layer by background tone step, not by borders (see the Epic #72 / #68–#71 palette work). The tonal direction flips per theme — dark raises brightness for higher layers, light lowers it — and `--border-*` stays weak and non-layering (focus rings, input affordance, occasional hairlines only).

## Why

Before this, the book-body palette and the chrome palette were separate literals that could drift, and a palette edit meant touching both the engine bridge and the token definitions by hand. Naming the body colors once and having every consumer read from that source keeps chrome and book body in sync from a single edit, which is what "the book body visually belongs to the same system" requires.

## Alternatives rejected

- Bridge book-body theming by injecting `var(--color-*)` into foliate section documents. Rejected: those documents do not inherit the host `:root`, so the variables resolve to nothing.
- Keep the engine palette as independent hard-coded literals. Rejected: guarantees drift between chrome and book body over time.
- Override Astryx `--color-*` in `:root`. Rejected: violates the Astryx rule; the theme is defined in `paperTheme.ts` and driven by a single `mode`.

## Consequences

- A palette change is a single edit to `paperTheme.ts` (and, for chrome-only tokens, the matching `[data-theme]` block in `index.css`) and reaches chrome and book body together.
- The reading engine bridge stays literal-valued by design; do not "modernize" it to CSS variables inside foliate documents.
- Adding a third theme would require re-expanding tuples across both token systems and the engine bridge; the two-theme constraint is intentional.
