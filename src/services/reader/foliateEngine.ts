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

type FoliateRenderer = {
  getContents?: () => FoliateContent[];
  setStyles?: (styles: string) => void;
};

type FoliateViewElement = HTMLElement & {
  book?: {
    sections?: Array<{ id?: string; cfi?: string }>;
    toc?: FoliateTocItem[];
  };
  renderer?: FoliateRenderer;
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

export function toFoliateThemeCss(styles: Record<string, Record<string, string>>): string {
  return Object.entries(styles)
    .map(([selector, rules]) => `${selector}{${Object.entries(rules).map(([key, value]) => `${key}:${value};`).join('')}}`)
    .join('\n');
}

export function applyFoliateManagedStyles(renderer: FoliateRenderer | undefined, css: string): boolean {
  if (!renderer?.setStyles) return false;
  renderer.setStyles(css);
  return true;
}

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

/**
 * FoliateRendition bridges foliate-js's custom-element event surface to the
 * ReadingEngineRendition contract consumed by reader hooks.
 *
 * Emitted events (consumed via `on(event, cb)`):
 *   - 'relocated' / 'locationChanged' — foliate `relocate` event → progress + TOC highlight.
 *   - 'selected'                      — a content-doc selection became non-empty; payload
 *                                       `(cfi, { window, document })`. Used to show SelectionToolbar.
 *   - 'selectionCleared'              — the content-doc selection collapsed (click on blank
 *                                       space, Esc, etc.). SelectionToolbar listens to dismiss.
 *
 * Selection listeners attach once per loaded section via foliate's `load` event, so we
 * never need to reach across foliate's closed shadow root from the host page.
 */
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

    // `selected` fires on every non-empty selection change so the store tracks the
    // live text as the user drags; downstream `setSelectedText` dedupes unchanged
    // text. Only the collapsed transition is edge-detected, so `selectionCleared`
    // fires once when the user clicks blank space instead of repeating.
    let hasSelection = false;

    const evaluate = () => {
      const selection = doc.defaultView?.getSelection();
      const hasText = !!selection && !selection.isCollapsed && selection.rangeCount > 0
        && !!selection.toString().trim();

      if (hasText) {
        hasSelection = true;
        const range = selection!.getRangeAt(0);
        const cfi = typeof index === 'number' ? this.view.getCFI?.(index, range) ?? '' : '';
        this.bridge.emit('selected', cfi, { window: doc.defaultView, document: doc });
      } else if (hasSelection) {
        hasSelection = false;
        this.bridge.emit('selectionCleared');
      }
    };

    doc.addEventListener('selectionchange', evaluate);
    doc.addEventListener('mouseup', evaluate);
    doc.addEventListener('keyup', evaluate);
    this.selectionCleanups.push(() => {
      doc.removeEventListener('selectionchange', evaluate);
      doc.removeEventListener('mouseup', evaluate);
      doc.removeEventListener('keyup', evaluate);
    });
  }

  private applyTheme(): void {
    const css = toFoliateThemeCss(this.themeStyles);
    applyFoliateManagedStyles(this.view.renderer, css);
    for (const content of this.getContents()) this.applyThemeToDocument(content.document, css);
  }

  private applyThemeToDocument(doc?: Document, css = toFoliateThemeCss(this.themeStyles)): void {
    if (!doc) return;
    if (!this.view.renderer?.setStyles) {
      const id = 'creader-foliate-theme';
      let style = doc.getElementById(id) as HTMLStyleElement | null;
      if (!style) {
        style = doc.createElement('style');
        style.id = id;
        doc.head.append(style);
      }
      style.textContent = css;
    }

    // foliate snapshots the section body background at load and repaints it from
    // its own shadow-DOM `#background` layer (`paginator.js` →
    // `#replaceBackground`). The public `renderer.setStyles()` path above
    // schedules that replacement on the next animation frame, so the old
    // background does not linger until a page turn. `--theme-bg-color` is
    // foliate's hook for substituting the live theme into that replacement.
    const bodyBackground = this.themeStyles.body?.background;
    const bgColor = bodyBackground?.replace(/\s*!important\s*$/, '');
    if (bgColor) doc.documentElement.style.setProperty('--theme-bg-color', bgColor);
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

    return {
      name: 'foliate',
      rendition,
      toc: toNavItems(view.book?.toc),
      destroy: () => rendition.destroy(),
    };
  },
};
