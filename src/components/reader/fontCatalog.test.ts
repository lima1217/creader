import { describe, expect, it } from 'vitest';
import {
  BUILTIN_FONT_DEFINITIONS,
  FIXED_FONT_FAMILY_KEY,
  resolveFontStack,
} from './fontCatalog';

describe('fontCatalog', () => {
  it('exposes two builtin font definitions', () => {
    expect(BUILTIN_FONT_DEFINITIONS.map((entry) => entry.key)).toEqual([
      'builtin-roboto',
      'builtin-lxgw-wenkai',
    ]);
  });

  it.each([
    [
      'builtin-roboto',
      '"CReader Roboto", "CReader LXGW WenKai", -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
    ],
    ['builtin-lxgw-wenkai', '"CReader LXGW WenKai", "Songti SC", "Source Han Serif SC", serif'],
  ] as const)('resolveFontStack(%s) returns the catalog stack', (key, stack) => {
    expect(resolveFontStack(key)).toBe(stack);
  });

  it('defaults to the fixed builtin-roboto stack', () => {
    expect(resolveFontStack()).toBe(resolveFontStack(FIXED_FONT_FAMILY_KEY));
    expect(BUILTIN_FONT_DEFINITIONS[0]?.faces).toHaveLength(3);
    expect(BUILTIN_FONT_DEFINITIONS[1]?.faces).toHaveLength(1);
  });
});
