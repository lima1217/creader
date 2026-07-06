import type { Theme } from '../../types';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { paperBodyPalette } from '../../theme/paperTheme';

/** Fixed typography — not user-adjustable (issue #91). */
export const EPUB_LINE_HEIGHT = 1.6;
export const EPUB_MAX_INLINE_SIZE = 700;

/**
 * Injects the reading-engine body theme into the rendered EPUB.
 *
 * The book body lives in its own DOM document (foliate section doc
 * iframe) and cannot see the host app's `:root` Astryx tokens, so colors are
 * taken as literal values from `paperBodyPalette` — the same source the Astryx
 * `--color-background-body` / `--color-text-primary` / `--color-accent` tokens
 * draw from (`paperTheme.ts`). A palette edit therefore reaches chrome and book
 * body from one place. See ADR-0011.
 *
 * Section-level alignment and hyphenation are applied in `foliateEngine.ts`
 * via `buildSectionTypographyCss` because they depend on each document's
 * `<html lang>`.
 */
export function buildFontStack(fontFamily: string): string {
  return `${fontFamily}, Georgia, serif`;
}

export function applyEpubTheme(
  rendition: ReaderRendition,
  options: { theme: Theme; fontStack: string; fontSize: number },
) {
  const palette = paperBodyPalette[options.theme];
  rendition.themes.default({
    body: {
      'font-family': options.fontStack,
      'font-size': `${options.fontSize}px`,
      'line-height': `${EPUB_LINE_HEIGHT}`,
      'color': `${palette.text} !important`,
      'background': `${palette.background} !important`,
      'margin': '0 auto !important',
    },
    p: {
      'margin-bottom': '1em',
    },
    a: {
      'color': `${palette.link} !important`,
    },
  });
}
