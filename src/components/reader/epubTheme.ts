import type { Rendition } from 'epubjs';
import type { Theme } from '../../types';
import { paperBodyPalette } from '../../theme/paperTheme';

/**
 * Injects the reading-engine body theme into the rendered EPUB.
 *
 * The book body lives in its own DOM document (foliate section doc / epubjs
 * iframe) and cannot see the host app's `:root` Astryx tokens, so colors are
 * taken as literal values from `paperBodyPalette` — the same source the Astryx
 * `--color-background-body` / `--color-text-primary` / `--color-accent` tokens
 * draw from (`paperTheme.ts`). A palette edit therefore reaches chrome and book
 * body from one place. See ADR-0011.
 *
 * The body background stays opaque: foliate renders each section inside an
 * iframe whose default canvas is white, and an opaque body background is what
 * covers that white so dark-mode text stays legible. (Making the body
 * transparent exposes the iframe's white canvas — a regression that obscured
 * dark-mode text.) The matching of foliate's own `#background` snapshot layer
 * to the live theme is handled in the foliate adapter, not here.
 *
 * Typography (font-family / size / line-height) stays driven by reader settings
 * and is intentionally not bridged to Astryx typography tokens.
 */
export function applyEpubTheme(
  rendition: Rendition,
  options: { theme: Theme; fontFamily: string; fontSize: number; lineHeight: number }
) {
  const palette = paperBodyPalette[options.theme];
  rendition.themes.default({
    body: {
      'font-family': `${options.fontFamily}, Georgia, serif`,
      'font-size': `${options.fontSize}px`,
      'line-height': `${options.lineHeight}`,
      'color': `${palette.text} !important`,
      'background': `${palette.background} !important`,
      'padding': '20px !important',
      'margin': '0 auto !important',
    },
    'p': {
      'margin-bottom': '1em',
      'color': `${palette.text} !important`,
    },
    'h1, h2, h3, h4, h5, h6': {
      'color': `${palette.text} !important`,
    },
    'a': {
      'color': `${palette.link} !important`,
    },
    'span, div': {
      'color': `${palette.text} !important`,
    },
  });
}
