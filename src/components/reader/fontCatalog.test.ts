import { describe, expect, it } from 'vitest';
import {
  BUILTIN_FONT_DEFINITION,
  CJK_READING_FONT_STACK,
  FIXED_FONT_FAMILY_KEY,
  resolveFontStack,
  resolveFontStackForLanguage,
  WESTERN_READING_FONT_STACK,
} from './fontCatalog';

describe('fontCatalog', () => {
  it('exposes the fixed builtin-roboto mixed stack', () => {
    expect(BUILTIN_FONT_DEFINITION.key).toBe('builtin-roboto');
    expect(BUILTIN_FONT_DEFINITION.fontStack).toBe(
      '"CReader Roboto", "CReader LXGW WenKai", -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
    );
    expect(BUILTIN_FONT_DEFINITION.faces).toHaveLength(4);
  });

  it('registers a synthetic bold LXGW WenKai face so weighted text stays in family', () => {
    const lxgw = BUILTIN_FONT_DEFINITION.faces.filter(
      (face) => face.fontFamily === 'CReader LXGW WenKai',
    );
    expect(lxgw).toHaveLength(2);
    expect(lxgw.map((face) => face.fontWeight ?? '400').sort()).toEqual(['400', '700']);
  });

  it('defaults resolveFontStack to the builtin definition', () => {
    expect(resolveFontStack()).toBe(BUILTIN_FONT_DEFINITION.fontStack);
    expect(FIXED_FONT_FAMILY_KEY).toBe('builtin-roboto');
  });

  it('orders the dominant script face first per language', () => {
    expect(resolveFontStackForLanguage('en')).toBe(WESTERN_READING_FONT_STACK);
    expect(resolveFontStackForLanguage('zh-CN')).toBe(CJK_READING_FONT_STACK);
    expect(resolveFontStackForLanguage('ja')).toBe(CJK_READING_FONT_STACK);
  });
});
