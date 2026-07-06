import { describe, expect, it } from 'vitest';
import type { CustomFontEntry } from '../../types';
import {
  BUILTIN_FONT_DEFINITIONS,
  FONT_CATALOG,
  customFontFamilyKey,
  fontFamilyNeedsInjection,
  listFontCatalogEntries,
  normalizeFontFamilyKey,
  resolveFontStack,
} from './fontCatalog';

const customFonts: CustomFontEntry[] = [
  { id: 'cf_1', label: '霞鹜文楷', path: '/tmp/LXGWWenKai.woff2' },
];

describe('fontCatalog', () => {
  it('exposes five whitelist entries with labels', () => {
    expect(FONT_CATALOG.map((entry) => entry.key)).toEqual([
      'system',
      'serif-cjk',
      'sans-cjk',
      'serif-latin',
      'sans-latin',
    ]);
    expect(FONT_CATALOG.map((entry) => entry.label)).toEqual([
      '系统默认',
      '衬线（中文）',
      '黑体（中文）',
      '西文衬线',
      '西文无衬线',
    ]);
  });

  it('lists builtin and custom entries after the whitelist', () => {
    const keys = listFontCatalogEntries(customFonts).map((entry) => entry.key);
    expect(keys).toEqual([
      'system',
      'serif-cjk',
      'sans-cjk',
      'serif-latin',
      'sans-latin',
      'builtin-bitter',
      'builtin-lxgw-wenkai',
      'custom:cf_1',
    ]);
  });

  it.each([
    ['system', 'system-ui, -apple-system, "PingFang SC", sans-serif'],
    ['serif-cjk', '"Songti SC", "Source Han Serif SC", Georgia, serif'],
    ['sans-cjk', '"PingFang SC", "Source Han Sans SC", "Helvetica Neue", sans-serif'],
    ['serif-latin', 'Georgia, "Times New Roman", serif'],
    ['sans-latin', '"Helvetica Neue", Arial, sans-serif'],
    ['builtin-bitter', '"CReader Bitter", Georgia, "Times New Roman", serif'],
    ['builtin-lxgw-wenkai', '"CReader LXGW WenKai", "Songti SC", "Source Han Serif SC", serif'],
    ['custom:cf_1', '"CReader Custom cf_1", Georgia, "Times New Roman", serif'],
  ] as const)('resolveFontStack(%s) returns the catalog stack', (key, stack) => {
    expect(resolveFontStack(key, customFonts)).toBe(stack);
  });

  it('migrates legacy Georgia to serif-latin stack', () => {
    expect(normalizeFontFamilyKey('Georgia')).toBe('serif-latin');
    expect(resolveFontStack('Georgia')).toBe('Georgia, "Times New Roman", serif');
  });

  it('falls back unknown values to serif-latin', () => {
    expect(normalizeFontFamilyKey('Merriweather')).toBe('serif-latin');
    expect(resolveFontStack('Merriweather')).toBe('Georgia, "Times New Roman", serif');
  });

  it('drops removed custom font keys to the default whitelist option', () => {
    expect(normalizeFontFamilyKey('custom:missing', customFonts)).toBe('serif-latin');
  });

  it('flags builtin and custom keys as injectable', () => {
    expect(fontFamilyNeedsInjection('serif-latin', customFonts)).toBe(false);
    expect(fontFamilyNeedsInjection('builtin-bitter', customFonts)).toBe(true);
    expect(fontFamilyNeedsInjection('builtin-lxgw-wenkai', customFonts)).toBe(true);
    expect(fontFamilyNeedsInjection(customFontFamilyKey('cf_1'), customFonts)).toBe(true);
    expect(BUILTIN_FONT_DEFINITIONS[0]?.faces).toHaveLength(2);
    expect(BUILTIN_FONT_DEFINITIONS[1]?.faces).toHaveLength(1);
  });
});
