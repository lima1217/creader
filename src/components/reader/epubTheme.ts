import type { Theme } from '../../types';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { CODE_FONT_STACK } from '../../services/reader/epubTypography';
import { paperBodyPalette } from '../../theme/paperTheme';

// Line measure lives on the layout contract (single source of truth); re-export
// here so body-typography consumers keep their existing import path.
export { EPUB_MAX_INLINE_SIZE } from '../../services/reader/readingEngine';

const PROSE_SELECTOR = 'p, li, blockquote, dd';

export type EpubThemeApplyOptions = {
  theme: Theme;
  fontStack: string;
  fontSize: number;
  fontFaceCss?: string;
  /**
   * When true, force CReader body typography over publisher EPUB styles.
   * Reserved for a future settings toggle; default false keeps heading and code
   * formatting while still applying theme colors and the reading font to prose.
   */
  forceTypographyOverride?: boolean;
};

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
 * Section-level typography (alignment, line-height, indent, paragraph margin,
 * hyphenation) is applied in `foliateEngine.ts` via `buildSectionTypographyCss`
 * because those values depend on each document's `<html lang>`.
 */
export function buildEpubThemeStyles(
  options: EpubThemeApplyOptions,
): Record<string, Record<string, string>> {
  const palette = paperBodyPalette[options.theme];
  const force = options.forceTypographyOverride ?? false;

  const styles: Record<string, Record<string, string>> = {
    body: {
      'color': `${palette.text} !important`,
      'background': `${palette.background} !important`,
      'margin': '0 auto',
    },
    a: {
      'color': `${palette.link} !important`,
    },
    'pre, code, kbd': {
      'font-family': CODE_FONT_STACK,
    },
  };

  if (force) {
    styles.body['font-family'] = options.fontStack;
    styles.body['font-size'] = `${options.fontSize}px`;
    styles.p = { 'margin-bottom': '1em' };
  } else {
    styles[PROSE_SELECTOR] = {
      'font-family': options.fontStack,
      'font-size': `${options.fontSize}px`,
    };
  }

  return styles;
}

export function applyEpubTheme(
  rendition: ReaderRendition,
  options: EpubThemeApplyOptions,
) {
  rendition.themes.default(buildEpubThemeStyles(options), { fontFaceCss: options.fontFaceCss });
}
