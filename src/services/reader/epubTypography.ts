const CJK_LANG_PREFIXES = new Set(['zh', 'ja', 'ko', 'kr']);

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

/** CSS block injected per section document in `foliateEngine.applyThemeToDocument`. */
export function buildSectionTypographyCss(lang: string): string {
  const left = shouldUseLeftAlign(lang);
  const shared = 'hanging-punctuation:allow-end last;text-autospace:ideograph-alpha ideograph-numeric;';
  const align = left
    ? 'text-align:left;'
    : 'text-align:justify;-webkit-hyphens:auto;hyphens:auto;-webkit-hyphenate-limit-before:3;-webkit-hyphenate-limit-after:2;-webkit-hyphenate-limit-lines:2;';
  return `body,p,li,blockquote,dd{${align}${shared}}`;
}
