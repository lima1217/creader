import type { NavItem } from '../../types';
import type { RenditionContent } from './epubAdapter';
import type { ReadingEngineAdapter, ReadingEngineInstance, ReadingEngineOptions, ReadingEngineRendition } from './readingEngine';

type FoliateLocation = {
  cfi?: string;
  fraction?: number;
  index?: number;
  range?: Range;
  tocItem?: { href?: string; label?: string };
};

type FoliateContent = {
  doc?: Document;
  index?: number;
};

type FoliateViewElement = HTMLElement & {
  book?: {
    sections?: Array<{ id?: string; cfi?: string }>;
    toc?: FoliateTocItem[];
  };
  renderer?: {
    getContents?: () => FoliateContent[];
  };
  lastLocation?: FoliateLocation | null;
  open(book: File | Blob | string | unknown): Promise<void>;
  init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
  goTo(target?: string | number | { fraction: number }): Promise<unknown>;
  prev(distance?: number): Promise<void>;
  next(distance?: number): Promise<void>;
  close(): void;
  getCFI?(index: number, range?: Range): string;
};

type FoliateTocItem = {
  id?: string | number;
  href?: string;
  label?: string;
  subitems?: FoliateTocItem[];
};

class FoliateRenditionEventBridge {
  private readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: string, callback: (...args: unknown[]) => void): void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(callback);
    this.handlers.set(event, set);
  }

  off(event: string, callback: (...args: unknown[]) => void): void {
    this.handlers.get(event)?.delete(callback);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const callback of this.handlers.get(event) ?? []) callback(...args);
  }
}

class FoliateRendition implements ReadingEngineRendition {
  readonly engineName = 'foliate' as const;
  readonly themes = {
    default: (styles: Record<string, Record<string, string>>) => {
      this.themeStyles = styles;
      this.applyTheme();
    },
    register: (_name: string, styles: Record<string, Record<string, string>>) => {
      this.themeStyles = styles;
      this.applyTheme();
    },
    select: () => {
      this.applyTheme();
    },
  };

  private readonly bridge = new FoliateRenditionEventBridge();
  private readonly selectionCleanups: Array<() => void> = [];
  private themeStyles: Record<string, Record<string, string>> = {};
  private initialized = false;

  constructor(private readonly view: FoliateViewElement) {
    view.addEventListener('relocate', event => {
      const detail = (event as CustomEvent<FoliateLocation>).detail;
      const location = this.toEpubLocation(detail);
      this.bridge.emit('relocated', location);
      this.bridge.emit('locationChanged', location);
    });

    view.addEventListener('load', event => {
      const detail = (event as CustomEvent<{ doc?: Document; index?: number }>).detail;
      this.attachSelectionListener(detail.doc, detail.index);
      this.applyThemeToDocument(detail.doc);
    });
  }

  async display(target?: string): Promise<void> {
    if (!this.initialized) {
      this.initialized = true;
      await this.view.init({ lastLocation: target, showTextStart: !target });
      return;
    }
    if (target) await this.view.goTo(target);
  }

  async prev(): Promise<void> {
    await this.view.prev();
  }

  async next(): Promise<void> {
    await this.view.next();
  }

  on(event: string, callback: (...args: unknown[]) => void): void {
    this.bridge.on(event, callback);
  }

  off(event: string, callback: (...args: unknown[]) => void): void {
    this.bridge.off(event, callback);
  }

  currentLocation(): unknown {
    return this.toEpubLocation(this.view.lastLocation ?? undefined);
  }

  getContents(): RenditionContent[] {
    return this.view.renderer?.getContents?.().map(content => ({
      document: content.doc,
      window: content.doc?.defaultView ?? undefined,
    })) ?? [];
  }

  destroy(): void {
    for (const cleanup of this.selectionCleanups.splice(0)) cleanup();
    this.view.close();
    this.view.remove();
  }

  private toEpubLocation(location?: FoliateLocation): unknown {
    const cfi = location?.cfi ?? '';
    const percentage = typeof location?.fraction === 'number' ? location.fraction : 0;
    return {
      start: {
        cfi,
        href: location?.tocItem?.href,
        index: location?.index,
        percentage,
      },
      end: { cfi, percentage },
    };
  }

  private attachSelectionListener(doc?: Document, index?: number): void {
    if (!doc) return;

    const emitSelected = () => {
      const selection = doc.defaultView?.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const cfi = typeof index === 'number' ? this.view.getCFI?.(index, range) ?? '' : '';
      this.bridge.emit('selected', cfi, { window: doc.defaultView, document: doc });
    };

    doc.addEventListener('selectionchange', emitSelected);
    doc.addEventListener('mouseup', emitSelected);
    doc.addEventListener('keyup', emitSelected);
    this.selectionCleanups.push(() => {
      doc.removeEventListener('selectionchange', emitSelected);
      doc.removeEventListener('mouseup', emitSelected);
      doc.removeEventListener('keyup', emitSelected);
    });
  }

  private applyTheme(): void {
    for (const content of this.getContents()) this.applyThemeToDocument(content.document);
  }

  private applyThemeToDocument(doc?: Document): void {
    if (!doc) return;
    const id = 'creader-foliate-theme';
    let style = doc.getElementById(id) as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement('style');
      style.id = id;
      doc.head.append(style);
    }
    style.textContent = Object.entries(this.themeStyles)
      .map(([selector, rules]) => `${selector}{${Object.entries(rules).map(([key, value]) => `${key}:${value};`).join('')}}`)
      .join('\n');
  }
}

function toNavItems(items: FoliateTocItem[] | undefined): NavItem[] {
  return (items ?? []).map((item, index) => ({
    id: String(item.id ?? item.href ?? index),
    href: item.href ?? '',
    label: item.label ?? item.href ?? `Chapter ${index + 1}`,
    subitems: toNavItems(item.subitems),
  }));
}

export const foliateEngineAdapter: ReadingEngineAdapter = {
  name: 'foliate',
  supports: {
    navigation: true,
    selection: true,
    progress: true,
    searchLocatorNavigation: true,
    theme: true,
    cfi: 'epub-cfi',
  },
  async open({ appBook, arrayBuffer, container }: ReadingEngineOptions): Promise<ReadingEngineInstance> {
    await import('foliate-js/view.js');
    const view = document.createElement('foliate-view') as FoliateViewElement;
    view.classList.add('foliate-reader-view');
    container.replaceChildren(view);

    const file = new File([arrayBuffer], appBook.title || 'book.epub', {
      type: 'application/epub+zip',
    });
    await view.open(file);

    const rendition = new FoliateRendition(view);
    const sections = view.book?.sections ?? [];
    const bookLike = {
      spine: {
        length: sections.length,
        spineItems: sections.map((section, index) => ({
          href: String(section.id ?? index),
          idref: String(section.id ?? index),
        })),
      },
    } as unknown as ReadingEngineInstance['bookLike'];

    return {
      name: 'foliate',
      bookLike,
      rendition,
      toc: toNavItems(view.book?.toc),
      locationsAvailable: true,
      destroy: () => rendition.destroy(),
    };
  },
};
