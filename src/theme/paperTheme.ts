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
  light: { background: '#F7F3EA', text: '#2B2B2B', link: '#33526E' },
  dark: { background: '#1A1B1E', text: '#D4D4D4', link: '#7EB0E0' },
} as const;

/**
 * Paper theme — CReader's warm Paper Workspace palette mapped onto Astryx's
 * `--color-*` token system.
 *
 * Values mirror the existing `[data-theme="light"]` and `[data-theme="dark"]`
 * blocks in index.css. Token values are `[light, dark]` tuples that Astryx
 * compiles to CSS `light-dark()`, so a single `mode` on `<Theme>` drives both
 * sides.
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
    // Surfaces — light uses the warm paper palette; dark uses neutral gray tones.
    // Body background/text come from `paperBodyPalette` so the reading-engine
    // theme bridge (`epubTheme.ts`) injects the same values into the book body.
    '--color-background-body': [paperBodyPalette.light.background, paperBodyPalette.dark.background],
    '--color-background-surface': ['#F4F1E9', '#212226'],
    '--color-background-card': ['#F4F1E9', '#26272B'],
    '--color-background-muted': ['#EFEBE1', '#2D2E33'],
    '--color-background-popover': ['#F4F1E9', '#26272B'],
    '--color-background-inverted': ['#2B2B2B', '#FBF9F4'],

    // Text. Body text mirrors `paperBodyPalette` for parity with the book body.
    '--color-text-primary': [paperBodyPalette.light.text, paperBodyPalette.dark.text],
    '--color-text-secondary': ['#5A5A57', '#ABABAB'],
    '--color-text-disabled': ['#A8A29A', '#6E6E6E'],

    // Accent — ink blue in light, sky blue in dark. Matches `paperBodyPalette`
    // link so book-body links stay in sync with chrome accent.
    '--color-accent': [paperBodyPalette.light.link, paperBodyPalette.dark.link],
    '--color-accent-muted': ['rgba(51, 82, 110, 0.07)', 'rgba(126, 176, 224, 0.12)'],
    '--color-on-accent': ['#FFFFFF', '#1A1B1E'],
    '--color-text-accent': ['#33526E', '#7EB0E0'],
    '--color-icon-accent': ['#33526E', '#7EB0E0'],
    '--color-icon-primary': ['#2B2B2B', '#D4D4D4'],
    '--color-icon-secondary': ['#5A5A57', '#ABABAB'],

    // Borders.
    '--color-border': ['rgba(43, 43, 43, 0.12)', 'rgba(255, 255, 255, 0.08)'],
    '--color-border-emphasized': ['rgba(43, 43, 43, 0.20)', 'rgba(255, 255, 255, 0.14)'],

    // Status — keep parity with the existing light/dark success/warning/error tokens.
    '--color-success': ['#3E7D5B', '#73B58E'],
    '--color-success-muted': ['rgba(62, 125, 91, 0.12)', 'rgba(115, 181, 142, 0.14)'],
    '--color-on-success': ['#FFFFFF', '#1A1B1E'],
    '--color-warning': ['#9C6D1E', '#D5A64C'],
    '--color-warning-muted': ['rgba(156, 109, 30, 0.12)', 'rgba(213, 166, 76, 0.14)'],
    '--color-on-warning': ['#FFFFFF', '#1A1B1E'],
    '--color-error': ['#B84A3F', '#E06D62'],
    '--color-error-muted': ['rgba(184, 74, 63, 0.12)', 'rgba(224, 109, 98, 0.14)'],
    '--color-on-error': ['#FFFFFF', '#1A1B1E'],
  },
});
