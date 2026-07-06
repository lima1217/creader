import { describe, expect, it } from 'vitest';
import { buildSectionTypographyCss, isCjkLang, shouldUseLeftAlign } from './epubTypography';

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
  it('defaults empty lang to left align', () => {
    expect(shouldUseLeftAlign('')).toBe(true);
    expect(shouldUseLeftAlign('   ')).toBe(true);
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
    expect(css).toContain('line-height:1.4');
    expect(css).toContain('text-indent:0');
    expect(css).toContain('margin-top:0.6em');
    expect(css).toContain('margin-bottom:0.6em');
    expect(css).toContain('widows:2');
    expect(css).toContain('orphans:2');
    expect(css).toContain('hanging-punctuation:allow-end last');
  });

  it('left-aligns and indents CJK sections without hyphenation', () => {
    const css = buildSectionTypographyCss('zh-CN');
    expect(css).toContain('text-align:left');
    expect(css).toContain('line-height:1.6');
    expect(css).toContain('text-indent:2em');
    expect(css).toContain('margin-top:1em');
    expect(css).toContain('margin-bottom:1em');
    expect(css).toContain('widows:1');
    expect(css).toContain('orphans:1');
    expect(css).not.toContain('hyphens:auto');
    expect(css).toContain('text-autospace:ideograph-alpha ideograph-numeric');
  });

  it('defaults to CJK typography when lang metadata is missing', () => {
    const css = buildSectionTypographyCss('');
    expect(css).toContain('text-align:left');
    expect(css).toContain('text-indent:2em');
    expect(css).toContain('line-height:1.6');
  });
});
