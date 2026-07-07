const CJK_LANG_PREFIXES = new Set(['zh', 'ja', 'ko', 'kr']);

export const CODE_FONT_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

/**
 * True when `lang` is Chinese, Japanese, or Korean (BCP 47 primary subtag).
 * `kr` is included for foliate's historical typo; `ko` is the canonical code.
 */
export function isCjkLang(lang: string): boolean {
  const primary = lang.trim().split(/[-_]/)[0]?.toLowerCase() ?? '';
  return CJK_LANG_PREFIXES.has(primary);
}

/**
 * Per-section alignment and hyphenation. Empty or missing `lang` defaults to left
 * align so CJK punctuation edge cases are avoided when metadata is absent.
 */
export function shouldUseLeftAlign(lang: string): boolean {
  const trimmed = lang.trim();
  if (!trimmed) return true;
  return isCjkLang(trimmed);
}

/**
 * CSS block injected per section document in `foliateEngine.applyThemeToDocument`.
 *
 * Typography values follow the Readest comfort defaults (issue #91 follow-up):
 * CJK sections get a 2em first-line indent, 1em paragraph spacing, and 1.6
 * line-height; western sections get no indent, 0.6em paragraph spacing,
 * justified hyphenated text, and a tighter 1.4 line-height. Both branches
 * keep hanging-punctuation and ideograph spacing for CJK punctuation edges.
 */
function codeTypographyShield(): string {
  return [
    'pre,code,kbd{',
    `font-family:${CODE_FONT_STACK};`,
    'line-height:normal;',
    'text-align:start;',
    '}',
  ].join('');
}

export function buildSectionTypographyCss(lang: string): string {
  const isCjk = isCjkLang(lang) || !lang.trim();
  const shield = codeTypographyShield();
  if (isCjk) {
    return [
      'body,p,li,blockquote,dd{',
      'text-align:left;',
      'line-height:1.6;',
      'p{text-indent:2em;margin-top:1em;margin-bottom:1em;}',
      'hanging-punctuation:allow-end last;',
      'text-autospace:ideograph-alpha ideograph-numeric;',
      'widows:1;orphans:1;',
      '}',
      shield,
    ].join('');
  }
  return [
    'body,p,li,blockquote,dd{',
    'text-align:justify;',
    'line-height:1.4;',
    'p{text-indent:0;margin-top:0.6em;margin-bottom:0.6em;}',
    '-webkit-hyphens:auto;hyphens:auto;',
    '-webkit-hyphenate-limit-before:3;-webkit-hyphenate-limit-after:2;-webkit-hyphenate-limit-lines:2;',
    'hyphenate-limit-before:3;hyphenate-limit-after:2;hyphenate-limit-lines:2;',
    'hanging-punctuation:allow-end last;',
    'widows:2;orphans:2;',
    '}',
    shield,
  ].join('');
}
