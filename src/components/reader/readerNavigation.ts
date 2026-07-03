import type { NavItem } from '../../types';
import type { ReaderSearchResult } from '../../services/reader/types';

export function normalizeNavigationHref(href: string | undefined): string {
  return (href ?? '').trim().replace(/^\.\//, '');
}

function hrefPath(href: string): string {
  return href.split('#')[0];
}

export function isTocItemActive(itemHref: string, currentHref: string): boolean {
  const item = normalizeNavigationHref(itemHref);
  const current = normalizeNavigationHref(currentHref);
  if (!item || !current) return false;
  if (item.includes('#')) return item === current;
  return hrefPath(item) === hrefPath(current);
}

export function findChapterLabelByHref(toc: NavItem[], href: string): string {
  const target = hrefPath(normalizeNavigationHref(href));
  if (!target) return '';

  const walk = (items: NavItem[]): string => {
    for (const item of items) {
      if (hrefPath(normalizeNavigationHref(item.href)) === target) return item.label;
      const nested = walk(item.subitems ?? []);
      if (nested) return nested;
    }
    return '';
  };

  return walk(toc);
}

export function resolveSearchResultTarget(result: ReaderSearchResult): string {
  return (
    result.locator?.cfi?.trim() ||
    result.locator?.href?.trim() ||
    result.cfi?.trim() ||
    ''
  );
}
