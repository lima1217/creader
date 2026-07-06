import { describe, expect, it } from 'vitest';
import {
  FONT_CATALOG,
  normalizeFontFamilyKey,
  resolveFontStack,
} from './fontCatalog';

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

  it.each([
    ['system', 'system-ui, -apple-system, "PingFang SC", sans-serif'],
    ['serif-cjk', '"Songti SC", "Source Han Serif SC", Georgia, serif'],
    ['sans-cjk', '"PingFang SC", "Source Han Sans SC", "Helvetica Neue", sans-serif'],
    ['serif-latin', 'Georgia, "Times New Roman", serif'],
    ['sans-latin', '"Helvetica Neue", Arial, sans-serif'],
  ] as const)('resolveFontStack(%s) returns the catalog stack', (key, stack) => {
    expect(resolveFontStack(key)).toBe(stack);
  });

  it('migrates legacy Georgia to serif-latin stack', () => {
    expect(normalizeFontFamilyKey('Georgia')).toBe('serif-latin');
    expect(resolveFontStack('Georgia')).toBe('Georgia, "Times New Roman", serif');
  });

  it('falls back unknown values to serif-latin', () => {
    expect(normalizeFontFamilyKey('Merriweather')).toBe('serif-latin');
    expect(resolveFontStack('Merriweather')).toBe('Georgia, "Times New Roman", serif');
  });
});
