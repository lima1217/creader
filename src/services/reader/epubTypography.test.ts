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
  it('justifies and hyphenates western sections', () => {
    const css = buildSectionTypographyCss('en');
    expect(css).toContain('text-align:justify');
    expect(css).toContain('hyphens:auto');
    expect(css).toContain('hanging-punctuation:allow-end last');
    expect(css).toContain('text-autospace:ideograph-alpha ideograph-numeric');
  });

  it('left-aligns CJK sections without hyphenation', () => {
    const css = buildSectionTypographyCss('zh-CN');
    expect(css).toContain('text-align:left');
    expect(css).not.toContain('hyphens:auto');
  });

  it('left-aligns when lang metadata is missing', () => {
    expect(buildSectionTypographyCss('')).toContain('text-align:left');
  });
});
