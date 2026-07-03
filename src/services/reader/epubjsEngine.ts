import ePub from 'epubjs';
import type { Book as EpubBook, Rendition } from 'epubjs';
import type { NavItem } from '../../types';
import type { EpubBookLike } from './epubAdapter';
import type { ReadingEngineAdapter, ReadingEngineInstance, ReadingEngineOptions, ReadingEngineRendition } from './readingEngine';

function toNavItems(book: EpubBookLike): NavItem[] {
  return (book.navigation?.toc ?? []).map((item: { id: string; href: string; label: string; subitems?: Array<{ id: string; href: string; label: string }> }) => ({
    id: item.id,
    href: item.href,
    label: item.label,
    subitems: item.subitems?.map(sub => ({
      id: sub.id,
      href: sub.href,
      label: sub.label,
    })),
  }));
}

export const epubjsEngineAdapter: ReadingEngineAdapter = {
  name: 'epubjs',
  supports: {
    navigation: true,
    selection: true,
    progress: true,
    searchLocatorNavigation: true,
    theme: true,
    cfi: 'epub-cfi',
  },
  async open({ arrayBuffer, container, scriptsEnabled }: ReadingEngineOptions): Promise<ReadingEngineInstance> {
    const book = ePub(arrayBuffer) as unknown as EpubBook;
    await (book as EpubBookLike).ready;

    const bookLike = book as unknown as EpubBookLike;
    const rendition = (book as unknown as EpubBookLike).renderTo(container, {
      width: '100%',
      height: '100%',
      spread: 'none',
      flow: 'paginated',
      allowScriptedContent: scriptsEnabled,
      sandbox: scriptsEnabled ? ['allow-same-origin', 'allow-scripts'] : ['allow-same-origin'],
    }) as Rendition & ReadingEngineRendition;
    rendition.engineName = 'epubjs';

    return {
      name: 'epubjs',
      bookLike,
      rendition,
      toc: toNavItems(bookLike),
      locationsAvailable: false,
      destroy: () => {
        book.destroy();
      },
    };
  },
};
