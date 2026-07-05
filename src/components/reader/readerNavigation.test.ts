import { describe, expect, it } from 'vitest';
import { isTocItemActive, normalizeNavigationHref } from './readerNavigation';

describe('readerNavigation', () => {
  it('normalizes simple relative href prefixes', () => {
    expect(normalizeNavigationHref('./chapter.xhtml#p1')).toBe('chapter.xhtml#p1');
  });

  it('matches TOC items by exact fragment or by same spine document', () => {
    expect(isTocItemActive('chapter1.xhtml', 'chapter1.xhtml#p2')).toBe(true);
    expect(isTocItemActive('chapter1.xhtml#scene-1', 'chapter1.xhtml#scene-1')).toBe(true);
    expect(isTocItemActive('chapter1.xhtml#scene-1', 'chapter1.xhtml#scene-2')).toBe(false);
    expect(isTocItemActive('chapter1.xhtml', 'chapter10.xhtml')).toBe(false);
  });
});
