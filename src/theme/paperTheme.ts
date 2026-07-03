import { defineTheme } from '@astryxdesign/core/theme';

/**
 * Book-body palette — the three colors the reading engine injects into the
 * rendered EPUB body (background, text, link). This is the single source of
 * truth shared by the Astryx `--color-*` tokens below and the reading-engine
 * theme bridge in `src/components/reader/epubTheme.ts`.
 *
 * The book body renders in foliate-owned section documents that do NOT
 * inherit the host app's `:root` tokens, so the engine
 * bridge injects these literal values rather than `var(--color-*)`. Keeping
 * them named here means a palette edit reaches both chrome and body from one
 * place. See ADR-0011 ("token-level concern, separate from component-level
 * migration").
 */
export const paperBodyPalette = {
  light: { background: '#FBF7EF', text: '#1F2933', link: '#264466' },
  dark: { background: '#0B0D0F', text: 'rgba(238, 242, 246, 0.92)', link: '#7EB0E0' },
} as const;

/**
 * Paper theme — CReader's warm Paper Workspace palette mapped onto Astryx's
 * `--color-*` token system.
 *
 * Light values mirror the existing `[data-theme="light"]` block in index.css
 * (paper background #FBF7EF, ink-blue accent #264466); dark values mirror the
 * existing `[data-theme="dark"]` block. Token values are `[light, dark]` tuples
 * that Astryx compiles to CSS `light-dark()`, so a single `mode` on `<Theme>`
 * drives both sides.
 *
 * Native chrome continues to consume CReader's own tokens (`--bg-primary`,
 * `--accent`, …); Astryx components consume these tokens. The two systems do
 * not collide and are fed from the same warm palette.
 *
 * The book-body surfaces (`--color-background-body`, `--color-text-primary`,
 * `--color-accent`) draw from `paperBodyPalette` so the reading-engine theme
 * bridge stays in sync with chrome. Typography stays system-native to preserve
 * CReader's current type feel.
 */
export const paperTheme = defineTheme({
  name: 'paper',
  typography: {
    body: {
      family: '-apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
    },
    heading: {
      family: '-apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
    },
  },
  tokens: {
    // Surfaces — light uses the warm paper palette; dark mirrors today's dark theme.
    // Body background/text come from `paperBodyPalette` so the reading-engine
    // theme bridge (`epubTheme.ts`) injects the same values into the book body.
    '--color-background-body': [paperBodyPalette.light.background, paperBodyPalette.dark.background],
    '--color-background-surface': ['#FFFDF8', '#12161A'],
    '--color-background-card': ['#FFFDF8', '#171C22'],
    '--color-background-muted': ['#F5EFE5', '#1A2026'],
    '--color-background-popover': ['#FFFDF8', '#171C22'],
    '--color-background-inverted': ['#1F2933', '#FFFDF8'],

    // Text. Body text mirrors `paperBodyPalette` for parity with the book body.
    '--color-text-primary': [paperBodyPalette.light.text, paperBodyPalette.dark.text],
    '--color-text-secondary': ['#53606B', 'rgba(205, 214, 223, 0.72)'],
    '--color-text-disabled': ['#A3988A', 'rgba(172, 181, 190, 0.42)'],

    // Accent — ink blue in light, sky blue in dark. Matches `paperBodyPalette`
    // link so book-body links stay in sync with chrome accent.
    '--color-accent': [paperBodyPalette.light.link, paperBodyPalette.dark.link],
    '--color-accent-muted': ['rgba(38, 68, 102, 0.075)', 'rgba(126, 176, 224, 0.12)'],
    '--color-on-accent': ['#FFFFFF', '#0B0D0F'],
    '--color-text-accent': ['#264466', '#7EB0E0'],
    '--color-icon-accent': ['#264466', '#7EB0E0'],
    '--color-icon-primary': ['#1F2933', 'rgba(238, 242, 246, 0.92)'],
    '--color-icon-secondary': ['#53606B', 'rgba(205, 214, 223, 0.72)'],

    // Borders.
    '--color-border': ['rgba(48, 43, 36, 0.13)', 'rgba(255, 255, 255, 0.09)'],
    '--color-border-emphasized': ['rgba(48, 43, 36, 0.22)', 'rgba(255, 255, 255, 0.16)'],

    // Status — keep parity with the existing light/dark success/warning/error tokens.
    '--color-success': ['#3E7D5B', '#73B58E'],
    '--color-success-muted': ['rgba(62, 125, 91, 0.12)', 'rgba(115, 181, 142, 0.14)'],
    '--color-on-success': ['#FFFFFF', '#0B0D0F'],
    '--color-warning': ['#9C6D1E', '#D5A64C'],
    '--color-warning-muted': ['rgba(156, 109, 30, 0.12)', 'rgba(213, 166, 76, 0.14)'],
    '--color-on-warning': ['#FFFFFF', '#0B0D0F'],
    '--color-error': ['#B84A3F', '#E06D62'],
    '--color-error-muted': ['rgba(184, 74, 63, 0.12)', 'rgba(224, 109, 98, 0.14)'],
    '--color-on-error': ['#FFFFFF', '#0B0D0F'],
  },
});
