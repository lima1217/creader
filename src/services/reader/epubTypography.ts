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
 * Per-section alignment and hyphenation. Empty or missing `lang` defaults to
 * western justify so English sections without metadata keep block paragraphs.
 */
export function shouldUseLeftAlign(lang: string): boolean {
  const trimmed = lang.trim();
  if (!trimmed) return false;
  return isCjkLang(trimmed);
}

/**
 * CSS block injected per section document in `foliateEngine.applyThemeToDocument`.
 *
 * Typography values follow the Readest comfort defaults (issue #91 follow-up):
 * CJK sections get a 2em first-line indent, 1em paragraph spacing, and 1.6
 * line-height; western sections (including missing `lang`) get no indent, 0.6em
 * paragraph spacing, justified hyphenated text, and a tighter 1.4 line-height.
 * Declarations use `!important` so CReader typography wins over publisher EPUB
 * styles. Both branches keep hanging-punctuation; CJK also sets ideograph spacing.
 */
const IMPORTANT = ' !important';

function codeTypographyShield(): string {
  return [
    'pre,code,kbd{',
    `font-family:${CODE_FONT_STACK};`,
    'line-height:normal;',
    'text-align:start;',
    '}',
  ].join('');
}

/**
 * Per-language body typography values. Single source of truth shared by
 * `buildSectionTypographyCss` (the `<style>` block) and the inline
 * `forceReadingTypography` override. The inline pass exists because publisher
 * class rules (`.calibre2 p { line-height !important }`, specificity 0,1,1)
 * beat CReader's element-selector rules (`p { line-height !important }`, 0,0,1)
 * inside the shared author-!important cascade layer; inline !important wins
 * regardless of publisher specificity.
 */
export interface SectionTypographyTokens {
  /** Applied to body / p / li / blockquote / dd. */
  body: {
    'text-align': string;
    'line-height': string;
    'letter-spacing': string;
    'word-spacing': string;
  };
  /** Applied to p only. */
  paragraph: {
    'text-indent': string;
    'margin-top': string;
    'margin-bottom': string;
  };
}

export function sectionTypographyTokens(lang: string): SectionTypographyTokens {
  if (isCjkLang(lang)) {
    return {
      body: {
        'text-align': 'left',
        'line-height': '1.6',
        'letter-spacing': 'normal',
        'word-spacing': 'normal',
      },
      paragraph: {
        'text-indent': '2em',
        'margin-top': '1em',
        'margin-bottom': '1em',
      },
    };
  }
  return {
    body: {
      'text-align': 'justify',
      'line-height': '1.4',
      'letter-spacing': 'normal',
      'word-spacing': 'normal',
    },
    paragraph: {
      'text-indent': '0',
      'margin-top': '0.6em',
      'margin-bottom': '0.6em',
    },
  };
}

export function buildSectionTypographyCss(lang: string): string {
  const isCjk = isCjkLang(lang);
  const shield = codeTypographyShield();
  const t = sectionTypographyTokens(lang);
  const bodyBlock = [
    `text-align:${t.body['text-align']}${IMPORTANT};`,
    `line-height:${t.body['line-height']}${IMPORTANT};`,
    `letter-spacing:${t.body['letter-spacing']}${IMPORTANT};word-spacing:${t.body['word-spacing']}${IMPORTANT};`,
  ];
  const paragraphBlock = [
    `text-indent:${t.paragraph['text-indent']}${IMPORTANT};`,
    `margin-top:${t.paragraph['margin-top']}${IMPORTANT};`,
    `margin-bottom:${t.paragraph['margin-bottom']}${IMPORTANT};`,
  ];
  if (isCjk) {
    return [
      'body,p,li,blockquote,dd{',
      ...bodyBlock,
      `hanging-punctuation:allow-end last${IMPORTANT};`,
      `text-autospace:ideograph-alpha ideograph-numeric${IMPORTANT};`,
      `widows:1${IMPORTANT};orphans:1${IMPORTANT};`,
      '}',
      `p{${paragraphBlock.join('')}}`,
      shield,
    ].join('');
  }
  return [
    'body,p,li,blockquote,dd{',
    ...bodyBlock,
    `-webkit-hyphens:auto${IMPORTANT};hyphens:auto${IMPORTANT};`,
    `-webkit-hyphenate-limit-before:3${IMPORTANT};-webkit-hyphenate-limit-after:2${IMPORTANT};-webkit-hyphenate-limit-lines:2${IMPORTANT};`,
    `hyphenate-limit-before:3${IMPORTANT};hyphenate-limit-after:2${IMPORTANT};hyphenate-limit-lines:2${IMPORTANT};`,
    `hanging-punctuation:allow-end last${IMPORTANT};`,
    `widows:2${IMPORTANT};orphans:2${IMPORTANT};`,
    '}',
    `p{${paragraphBlock.join('')}}`,
    shield,
  ].join('');
}

/** Per-section font cascade; direct family on each node beats publisher class rules. */
export function buildSectionFontCss(fontStack: string, fontSize: number): string {
  const textSelector = 'html body,html body *:not(pre):not(code):not(kbd):not(font)';
  const sizeSelector =
    'html body,html body *:not(pre):not(code):not(kbd):not(font):not(h1):not(h2):not(h3):not(h4):not(h5):not(h6)';
  return [
    `${textSelector}{font-family:${fontStack} !important;}`,
    `html body{font-size:${fontSize}px !important;}`,
    `${sizeSelector}{font-size:inherit !important;}`,
    `pre,code,kbd{font-family:${CODE_FONT_STACK};}`,
  ].join('');
}

/** Section reading CSS: resolved language → font stack + typography. */
export function buildSectionReadingCss(lang: string, fontStack: string, fontSize: number): string {
  return `${buildSectionFontCss(fontStack, fontSize)}\n${buildSectionTypographyCss(lang)}`;
}
