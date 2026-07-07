import type { Theme } from '../../types';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { paperBodyPalette } from '../../theme/paperTheme';

// Line measure lives on the layout contract (single source of truth); re-export
// here so body-typography consumers keep their existing import path.
export { EPUB_MAX_INLINE_SIZE } from '../../services/reader/readingEngine';

export type EpubThemeApplyOptions = {
  theme: Theme;
  fontStack: string;
  fontSize: number;
  fontFaceCss?: string;
  /**
   * When true, force CReader body typography over publisher EPUB styles.
   * Reserved for a future settings toggle; default false still unifies the
   * reading font on body while leaving heading sizes to the publisher.
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
 * hyphenation) and reading fonts are applied per section in `foliateEngine.ts`
 * because those values depend on each document's resolved language.
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
  };

  if (force) {
    styles.p = { 'margin-bottom': '1em' };
  }

  return styles;
}

export function applyEpubTheme(
  rendition: ReaderRendition,
  options: EpubThemeApplyOptions,
) {
  rendition.themes.default(buildEpubThemeStyles(options), {
    fontFaceCss: options.fontFaceCss,
    fontSize: options.fontSize,
  });
}
