import { describe, expect, it } from 'vitest';
import { buildSectionReadingCss, buildSectionTypographyCss, CODE_FONT_STACK, isCjkLang, shouldUseLeftAlign } from './epubTypography';
import { CJK_READING_FONT_STACK, WESTERN_READING_FONT_STACK } from '../../components/reader/fontCatalog';

describe('isCjkLang', () => {
  it('detects zh, ja, and ko primary subtags', () => {
    expect(isCjkLang('zh-CN')).toBe(true);
    expect(isCjkLang('ja')).toBe(true);
    expect(isCjkLang('ko-KR')).toBe(true);
    expect(isCjkLang('kr')).toBe(true);
  });

  it('treats western languages as non-CJK', () => {
    expect(isCjkLang('en')).toBe(false);
    expect(isCjkLang('en-US')).toBe(false);
    expect(isCjkLang('fr')).toBe(false);
  });
});

describe('shouldUseLeftAlign', () => {
  it('defaults empty lang to western justify', () => {
    expect(shouldUseLeftAlign('')).toBe(false);
    expect(shouldUseLeftAlign('   ')).toBe(false);
  });

  it('left-aligns CJK and justifies western languages', () => {
    expect(shouldUseLeftAlign('zh')).toBe(true);
    expect(shouldUseLeftAlign('en')).toBe(false);
  });
});

describe('buildSectionTypographyCss', () => {
  it('justifies, hyphenates, and tightens western sections', () => {
    const css = buildSectionTypographyCss('en');
    expect(css).toContain('text-align:justify');
    expect(css).toContain('hyphens:auto');
    expect(css).toContain('-webkit-hyphenate-limit-before:3');
    expect(css).toContain('-webkit-hyphenate-limit-after:2');
    expect(css).toContain('-webkit-hyphenate-limit-lines:2');
    expect(css).toContain('hyphenate-limit-before:3');
    expect(css).toContain('hyphenate-limit-after:2');
    expect(css).toContain('hyphenate-limit-lines:2');
    expect(css).toContain('line-height:1.4');
    expect(css).toContain('text-indent:0 !important');
    expect(css).toContain('margin-top:0.6em');
    expect(css).toContain('margin-bottom:0.6em');
    expect(css).toContain('widows:2');
    expect(css).toContain('orphans:2');
    expect(css).toContain('hanging-punctuation:allow-end last');
  });

  it('shields pre, code, and kbd from prose typography inheritance', () => {
    const css = buildSectionTypographyCss('en');
    expect(css).toContain(`pre,code,kbd{font-family:${CODE_FONT_STACK}`);
    expect(css).toContain('line-height:normal');
    expect(css).toContain('text-align:start');
  });

  it('left-aligns and indents CJK sections without hyphenation', () => {
    const css = buildSectionTypographyCss('zh-CN');
    expect(css).toContain('text-align:left !important');
    expect(css).toContain('line-height:1.6 !important');
    expect(css).toContain('text-indent:2em !important');
    expect(css).toContain('margin-top:1em');
    expect(css).toContain('margin-bottom:1em');
    expect(css).toContain('widows:1');
    expect(css).toContain('orphans:1');
    expect(css).not.toContain('hyphens:auto');
    expect(css).toContain('text-autospace:ideograph-alpha ideograph-numeric');
  });

  it('defaults to western typography when lang metadata is missing', () => {
    const css = buildSectionTypographyCss('');
    expect(css).toContain('text-align:justify !important');
    expect(css).toContain('text-indent:0 !important');
    expect(css).toContain('line-height:1.4 !important');
  });

  it('resets publisher letter-spacing in both script branches', () => {
    expect(buildSectionTypographyCss('zh-CN')).toContain('letter-spacing:normal !important');
    expect(buildSectionTypographyCss('en')).toContain('letter-spacing:normal !important');
  });

  it('builds per-section reading CSS with language-specific font stack', () => {
    const css = buildSectionReadingCss('zh-CN', CJK_READING_FONT_STACK, 18);
    expect(css).toContain(CJK_READING_FONT_STACK);
    expect(css).toContain('font-size:18px !important');
    expect(css).toContain('text-align:left !important');
    expect(css).toContain(`pre,code,kbd{font-family:${CODE_FONT_STACK}`);
  });

  it('uses the western stack for Latin sections', () => {
    const css = buildSectionReadingCss('en', WESTERN_READING_FONT_STACK, 16);
    expect(css).toContain(WESTERN_READING_FONT_STACK);
    expect(css).toContain('text-align:justify !important');
  });
});
