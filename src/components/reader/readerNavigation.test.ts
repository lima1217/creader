import { describe, expect, it } from 'vitest';
import type { NavItem } from '../../types';
import { findChapterLabelByHref, isTocItemActive, normalizeNavigationHref, resolveSearchResultTarget } from './readerNavigation';

const toc: NavItem[] = [
  {
    id: 'part-1',
    href: './part1.xhtml',
    label: 'Part 1',
    subitems: [
      {
        id: 'chapter-1',
        href: 'chapter1.xhtml',
        label: 'Chapter 1',
        subitems: [
          {
            id: 'scene-1',
            href: 'chapter1.xhtml#scene-1',
            label: 'Scene 1',
          },
        ],
      },
    ],
  },
];

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

  it('finds chapter labels through nested TOC items', () => {
    expect(findChapterLabelByHref(toc, 'chapter1.xhtml#p2')).toBe('Chapter 1');
    expect(findChapterLabelByHref(toc, 'chapter1.xhtml#scene-1')).toBe('Chapter 1');
    expect(findChapterLabelByHref(toc, 'unknown.xhtml')).toBe('');
  });

  it('prefers precise search CFI targets before coarse href and legacy cfi fields', () => {
    expect(resolveSearchResultTarget({
      excerpt: 'precise',
      cfi: 'chapter.xhtml',
      section: '',
      locator: { kind: 'cfi', cfi: 'epubcfi(/6/4)', href: 'chapter.xhtml', spineIndex: 0 },
    })).toBe('epubcfi(/6/4)');

    expect(resolveSearchResultTarget({
      excerpt: 'coarse',
      cfi: '',
      section: '',
      locator: { kind: 'href', href: 'chapter.xhtml#p2', spineIndex: 1 },
    })).toBe('chapter.xhtml#p2');

    expect(resolveSearchResultTarget({
      excerpt: 'legacy',
      cfi: 'chapter.xhtml',
      section: '',
    })).toBe('chapter.xhtml');
  });
});
