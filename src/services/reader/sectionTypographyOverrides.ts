import { sectionTypographyTokens } from './epubTypography';

const INLINE_TYPOGRAPHY_PROPS = [
  'font-family',
  'font-size',
  'letter-spacing',
  'word-spacing',
  'line-height',
  'text-indent',
] as const;

const SKIP_TYPOGRAPHY_FORCE_TAGS = new Set(['PRE', 'CODE', 'KBD', 'SCRIPT', 'STYLE']);
const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6';

export interface ForceTypographyOptions {
  /**
   * BCP-47 language tag used to pick CJK vs western body values
   * (line-height, alignment, indent). Defaults to CJK because the bug this
   * guard exists for is most visible on Chinese EPUBs; `buildSectionTypographyCss`
   * still owns the `<style>` block for sections where the resolved language is
   * western.
   */
  lang?: string;
}

/**
 * Remove publisher inline typography that blocks CReader fonts and spacing.
 * Common in Chinese EPUBs that wrap each run in `<span style="...">`.
 */
export function stripPublisherTypographyOverrides(doc: Document): void {
  for (const el of doc.querySelectorAll('[style]')) {
    const html = el as HTMLElement;
    for (const prop of INLINE_TYPOGRAPHY_PROPS) {
      html.style.removeProperty(prop);
    }
    if (!html.getAttribute('style')?.trim()) {
      html.removeAttribute('style');
    }
  }

  for (const el of doc.querySelectorAll('font[face], font[size]')) {
    el.removeAttribute('face');
    el.removeAttribute('size');
  }
}

function shouldForceFontSize(el: Element): boolean {
  if (SKIP_TYPOGRAPHY_FORCE_TAGS.has(el.tagName)) return false;
  if (el.matches(HEADING_SELECTOR)) return false;
  if (el.closest(HEADING_SELECTOR)) return false;
  return true;
}

/**
 * Inline `!important` beats linked EPUB stylesheets. Applied after CSS injection
 * so publisher class rules cannot keep embedded book fonts or fixed sizes.
 *
 * Body typography (line-height, alignment, indent, letter/word spacing) is also
 * forced inline because publisher class rules like `.calibre2 p { line-height
 * !important }` (specificity 0,1,1) beat CReader's element-selector rules
 * (`p { line-height !important }`, 0,0,1) inside the shared author-!important
 * cascade layer. Inline !important wins regardless of publisher specificity.
 * Values come from `sectionTypographyTokens` so the `<style>` block and this
 * inline pass stay in sync.
 */
export function forceReadingTypography(
  doc: Document,
  fontStack: string,
  fontSize: number,
  options: ForceTypographyOptions = {},
): void {
  const lang = options.lang ?? 'zh';
  const tokens = sectionTypographyTokens(lang);
  const bodyEntries = Object.entries(tokens.body);
  const isParagraph = (el: Element): boolean => el.tagName === 'P';

  for (const el of doc.querySelectorAll('body, body *')) {
    if (SKIP_TYPOGRAPHY_FORCE_TAGS.has(el.tagName)) continue;
    const html = el as HTMLElement;
    html.style.setProperty('font-family', fontStack, 'important');
    if (shouldForceFontSize(el)) {
      html.style.setProperty('font-size', `${fontSize}px`, 'important');
    }
    // Body typography (line-height / alignment / letter-spacing / word-spacing)
    // on every text-bearing element so the publisher's class rules cannot win.
    for (const [prop, value] of bodyEntries) {
      html.style.setProperty(prop, value, 'important');
    }
    // Paragraph-only block metrics (indent + vertical rhythm).
    if (isParagraph(el)) {
      for (const [prop, value] of Object.entries(tokens.paragraph)) {
        html.style.setProperty(prop, value, 'important');
      }
    }
  }
}

/** @deprecated Use {@link forceReadingTypography}. */
export function forceReadingFontFamily(doc: Document, fontStack: string): void {
  forceReadingTypography(doc, fontStack, 16);
}

export function ensureSectionFontFaces(doc: Document, fontFaceCss: string): void {
  if (!fontFaceCss) return;
  const id = 'creader-foliate-fonts';
  let style = doc.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = id;
    doc.head.prepend(style);
  }
  if (style.textContent !== fontFaceCss) {
    style.textContent = fontFaceCss;
  }
}
