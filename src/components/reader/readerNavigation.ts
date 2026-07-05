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
