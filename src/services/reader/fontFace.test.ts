import { describe, expect, it } from 'vitest';
import { buildFontFaceCss, toFontDataUrl } from './fontFace';

describe('fontFace', () => {
  it('builds @font-face rules with quoted family names', () => {
    const css = buildFontFaceCss([
      {
        fontFamily: 'CReader Literata',
        src: toFontDataUrl('abc', 'font/woff2'),
        fontWeight: '400',
        fontStyle: 'normal',
      },
    ]);

    expect(css).toContain('@font-face');
    expect(css).toContain('font-family: "CReader Literata"');
    expect(css).toContain('format("woff2")');
    expect(css).toContain('font-style: normal');
  });

  it('joins multiple face rules', () => {
    const css = buildFontFaceCss([
      {
        fontFamily: 'CReader Literata',
        src: toFontDataUrl('a', 'font/woff2'),
        fontStyle: 'normal',
      },
      {
        fontFamily: 'CReader Literata',
        src: toFontDataUrl('b', 'font/woff2'),
        fontStyle: 'italic',
      },
    ]);

    expect(css.split('@font-face').length - 1).toBe(2);
  });
});
