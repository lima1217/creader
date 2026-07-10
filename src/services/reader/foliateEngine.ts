import type { NavItem } from '../../types';
import type { RenditionContent } from './epubAdapter';
import type { ReadingEngineAdapter, ReadingEngineInstance, ReadingEngineOptions, ReadingEngineRendition, ReadingLayoutOptions } from './readingEngine';
import { buildSectionReadingCss } from './epubTypography';
import { ensureDocumentReadingFonts } from './fontLoader';
import { resolveSectionLanguage } from './sectionLanguage';
import {
  ensureSectionFontFaces,
  forceReadingTypography,
  stripPublisherTypographyOverrides,
} from './sectionTypographyOverrides';
import { resolveFontStackForLanguage } from '../../components/reader/fontCatalog';

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

type FoliateRendererRelocateDetail = {
  fraction?: number;
};

type FoliateSection = {
  linear?: string;
  createDocument?: () => Promise<Document>;
};

type FoliatePaginatorScroll = {
  scrolled?: boolean;
  start?: number;
  end?: number;
  viewSize?: number;
  atStart?: boolean;
  atEnd?: boolean;
  addEventListener?: (type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions) => void;
  removeEventListener?: (type: string, listener: (event: Event) => void, options?: boolean | EventListenerOptions) => void;
};

type FoliateRenderer = FoliatePaginatorScroll & {
  getContents?: () => FoliateContent[];
  setStyles?: (styles: string | [string, string]) => void;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  goTo?: (target: { index: number; anchor: () => number }) => Promise<void>;
};

export const SCROLLED_BOUNDARY_TOLERANCE_PX = 2;
export const SCROLLED_PREFETCH_DISTANCE_PX = 1200;

/**
 * Boundary-arming constants. When the reader reaches a chapter edge we no longer
 * turn immediately; instead we accumulate scroll intent and surface a UI hint
 * that must stay visible long enough for the user to see it.
 *
 * Why these values:
 * - `BOUNDARY_ARM_THRESHOLD_PX`: total scroll intent needed to turn. Sourced
 *   from real `|deltaY|` so one trackpad fling (which fires dozens of wheel
 *   events) accumulates the same as a single decisive mouse-wheel flick.
 * - `BOUNDARY_DELTA_CAP_PX`: per-event cap. Without it one large mouse-wheel
 *   tick (deltaY can be 100+) would blow past the threshold in a single event
 *   and the hint would never be visible. The cap forces at least a couple of
 *   events — i.e. a deliberate continued scroll — to turn.
 * - `BOUNDARY_ARM_MIN_VISIBLE_MS`: once armed, the hint must stay up at least
 *   this long before a turn is allowed. macOS fires 10–30 wheel events per
 *   gesture within ~50ms; without a min-visible gate the hint appears and is
 *   dismissed in the same frame, indistinguishable from the old instant turn.
 * - `BOUNDARY_ARM_DECAY_MS`: stop scrolling for this long and the arm resets.
 */
export const BOUNDARY_ARM_THRESHOLD_PX = 240;
export const BOUNDARY_DELTA_CAP_PX = 40;
export const BOUNDARY_ARM_MIN_VISIBLE_MS = 320;
export const BOUNDARY_ARM_DECAY_MS = 700;

export type BoundaryArmDirection = 'next' | 'prev';

export type BoundaryArmState = {
  direction: BoundaryArmDirection | null;
  progress: number;
  armed: boolean;
};

export function isScrolledAtBottom(
  metrics: { viewSize?: number; end?: number },
  tolerance = SCROLLED_BOUNDARY_TOLERANCE_PX,
): boolean {
  const viewSize = metrics.viewSize ?? 0;
  const end = metrics.end ?? 0;
  return viewSize - end <= tolerance;
}

export function isScrolledAtTop(
  metrics: { start?: number },
  tolerance = SCROLLED_BOUNDARY_TOLERANCE_PX,
): boolean {
  return (metrics.start ?? 0) <= tolerance;
}

export function shouldPrefetchAdjacentSections(
  metrics: { viewSize?: number; end?: number; start?: number },
  distance = SCROLLED_PREFETCH_DISTANCE_PX,
): { prefetchNext: boolean; prefetchPrev: boolean } {
  const viewSize = metrics.viewSize ?? 0;
  const start = metrics.start ?? 0;
  const end = metrics.end ?? 0;
  return {
    prefetchNext: viewSize - end <= distance,
    prefetchPrev: start <= distance,
  };
}

export function findAdjacentLinearSectionIndex(
  sections: FoliateSection[],
  currentIndex: number,
  direction: 1 | -1,
): number | null {
  for (let index = currentIndex + direction; index >= 0 && index < sections.length; index += direction) {
    if (sections[index]?.linear !== 'no') return index;
  }
  return null;
}

export type PaginatorScrollMetrics = {
  scrolled: boolean;
  start: number;
  end: number;
  viewSize: number;
  atStart: boolean;
  atEnd: boolean;
};

export function readPaginatorMetrics(renderer: FoliatePaginatorScroll | undefined): PaginatorScrollMetrics | null {
  if (!renderer?.scrolled) return null;
  try {
    return {
      scrolled: true,
      start: Number(renderer.start ?? 0),
      end: Number(renderer.end ?? 0),
      viewSize: Number(renderer.viewSize ?? 0),
      atStart: Boolean(renderer.atStart),
      atEnd: Boolean(renderer.atEnd),
    };
  } catch {
    // foliate paginator getters touch #view before the first section is displayed
    return null;
  }
}

type FoliateViewElement = HTMLElement & {
  book?: FoliateBook & {
    sections?: FoliateSection[];
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

type FoliateBook = {
  metadata?: {
    language?: string[];
  };
};

type FoliateThemeOptions = {
  fontFaceCss?: string;
  fontSize?: number;
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

export type FoliateManagedCss = string | [string, string];

export function composeFoliateThemeCss(
  styles: Record<string, Record<string, string>>,
  fontFaceCss = '',
): FoliateManagedCss {
  const rules = toFoliateThemeCss(styles);
  if (!fontFaceCss) return rules;
  return [fontFaceCss, rules];
}

export function applyFoliateManagedStyles(renderer: FoliateRenderer | undefined, css: FoliateManagedCss): boolean {
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

  clear(): void {
    this.handlers.clear();
  }
}

/**
 * FoliateRendition bridges foliate-js's custom-element event surface to the
 * ReadingEngineRendition contract consumed by reader hooks.
 *
 * Emitted events (consumed via `on(event, cb)`):
 *   - 'relocated' / 'locationChanged' — foliate `relocate` event → progress + TOC highlight.
 *   - 'selected'                      — selection preview or commit; payload
 *                                       `(cfi, { window, document })`. Preview
 *                                       events use an empty CFI while the user
 *                                       drags; commit events on mouseup/touchend/keyup
 *                                       include the foliate-generated EPUB CFI.
 *   - 'selectionCleared'              — the content-doc selection collapsed (click on blank
 *                                       space, Esc, etc.). SelectionToolbar listens to dismiss.
 *
 * Selection listeners attach once per loaded section via foliate's `load` event, so we
 * never need to reach across foliate's closed shadow root from the host page.
 */
class FoliateRendition implements ReadingEngineRendition {
  readonly engineName = 'foliate' as const;
  readonly themes = {
    default: (
      styles: Record<string, Record<string, string>>,
      options?: FoliateThemeOptions,
    ) => {
      this.themeStyles = styles;
      this.fontFaceCss = options?.fontFaceCss ?? '';
      if (options?.fontSize != null) this.readingFontSize = options.fontSize;
      this.applyTheme();
    },
    register: (
      _name: string,
      styles: Record<string, Record<string, string>>,
      options?: FoliateThemeOptions,
    ) => {
      this.themeStyles = styles;
      this.fontFaceCss = options?.fontFaceCss ?? '';
      if (options?.fontSize != null) this.readingFontSize = options.fontSize;
      this.applyTheme();
    },
    select: () => {
      this.applyTheme();
    },
  };

  private readonly bridge = new FoliateRenditionEventBridge();
  private readonly selectionCleanups: Array<() => void> = [];
  private readonly boundaryCleanups: Array<() => void> = [];
  private readonly prefetchedSectionIndices = new Set<number>();
  private themeStyles: Record<string, Record<string, string>> = {};
  private fontFaceCss = '';
  private readingFontSize = 16;
  private bookLanguageHint = '';
  private sectionTypographyToken = 0;
  private initialized = false;
  private sectionFraction: number | null = null;
  private boundaryNavLock = false;
  private scrolledBoundaryBridgeEnabled = false;
  private lastScrollStart = 0;
  private lastRelocatedSectionIndex: number | null = null;
  // Boundary arming: accumulate scroll intent at a chapter edge before turning.
  private armDirection: BoundaryArmDirection | null = null;
  private armAccumulated = 0;
  private armDecayTimer: ReturnType<typeof setTimeout> | null = null;
  private armShownAt = 0;
  private readonly onRendererRelocate = (event: Event) => {
    const fraction = (event as CustomEvent<FoliateRendererRelocateDetail>).detail?.fraction;
    if (typeof fraction === 'number' && Number.isFinite(fraction)) {
      this.sectionFraction = fraction;
    }
  };

  private readonly onViewRelocate = (event: Event) => {
    const detail = (event as CustomEvent<FoliateLocation>).detail;
    const location = this.toEpubLocation(detail);
    this.bridge.emit('relocated', location);
    this.bridge.emit('locationChanged', location);
    const index = detail.index;
    if (typeof index === 'number' && index !== this.lastRelocatedSectionIndex) {
      this.lastRelocatedSectionIndex = index;
      this.prefetchedSectionIndices.clear();
      this.resetScrollBoundaryTracking();
      this.clearBoundaryArm();
    }
  };

  private readonly onViewLoad = (event: Event) => {
    const detail = (event as CustomEvent<{ doc?: Document; index?: number }>).detail;
    this.attachSelectionListener(detail.doc, detail.index);
    this.applyThemeToDocument(detail.doc);
  };

  constructor(private readonly view: FoliateViewElement) {
    view.addEventListener('relocate', this.onViewRelocate);
    view.addEventListener('load', this.onViewLoad);
    this.attachRendererSectionTracking();
  }

  private attachRendererSectionTracking(): void {
    const renderer = this.view.renderer;
    if (!renderer?.addEventListener) return;
    // Capture so sectionFraction is updated before foliate-view handles the same event.
    renderer.addEventListener('relocate', this.onRendererRelocate, true);
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

  async goToChapterStart(): Promise<void> {
    await this.goToChapterEdge(0);
  }

  async goToChapterEnd(): Promise<void> {
    await this.goToChapterEdge(1);
  }

  async seekToFraction(fraction: number): Promise<void> {
    const view = this.view as unknown as { goToFraction?: (frac: number) => Promise<void> };
    if (view.goToFraction) {
      await view.goToFraction(fraction);
      return;
    }
    await this.view.goTo({ fraction });
  }

  getSectionFractions(): number[] {
    const view = this.view as unknown as { getSectionFractions?: () => number[] };
    return view.getSectionFractions?.() ?? [];
  }

  private async goToChapterEdge(anchor: number): Promise<void> {
    const index = this.view.lastLocation?.index;
    if (index == null) return;
    await this.view.renderer?.goTo?.({ index, anchor: () => anchor });
  }

  setLayout(opts: ReadingLayoutOptions): void {
    const r = this.view.renderer;
    if (!r) return;
    r.setAttribute('flow', opts.flow);
    if (opts.maxInlineSize != null) r.setAttribute('max-inline-size', `${opts.maxInlineSize}px`);
    if (opts.animated) r.setAttribute('animated', '');
    else r.removeAttribute('animated');
    if (opts.flow === 'scrolled') this.enableScrolledBoundaryBridge();
    else this.disableScrolledBoundaryBridge();
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
    this.disableScrolledBoundaryBridge();
    // Always cancel arm decay even if the scrolled bridge was never enabled.
    this.clearBoundaryArm();
    this.view.removeEventListener('relocate', this.onViewRelocate);
    this.view.removeEventListener('load', this.onViewLoad);
    this.view.renderer?.removeEventListener?.('relocate', this.onRendererRelocate, true);
    for (const cleanup of this.selectionCleanups.splice(0)) cleanup();
    this.bridge.clear();
    this.view.close();
    this.view.remove();
  }

  setBookLanguageHint(language: string): void {
    this.bookLanguageHint = language.trim();
  }

  private getScrollRenderer(): FoliatePaginatorScroll | undefined {
    return this.view.renderer;
  }

  private readScrollMetrics(): PaginatorScrollMetrics | null {
    return readPaginatorMetrics(this.getScrollRenderer());
  }

  private resetScrollBoundaryTracking(): void {
    const metrics = this.readScrollMetrics();
    this.lastScrollStart = metrics?.start ?? 0;
  }

  private enableScrolledBoundaryBridge(): void {
    if (this.scrolledBoundaryBridgeEnabled) return;
    const renderer = this.getScrollRenderer();
    if (!renderer?.addEventListener) return;

    const onScroll = () => {
      if (this.boundaryNavLock) return;
      const metrics = this.readScrollMetrics();
      if (!metrics?.scrolled) return;
      this.maybePrefetchAdjacentSections(metrics);
      // At a chapter edge the container is pinned: `start` stops changing, so a
      // strict "did start increase" check never passes and the next-direction arm
      // never fires (this was the "向下翻不显示" bug). Use a non-strict comparison
      // (>= / <=) so that being pinned at the edge still counts as intent.
      const scrollDown = metrics.start >= this.lastScrollStart - 1;
      const scrollUp = metrics.start <= this.lastScrollStart + 1;
      this.lastScrollStart = metrics.start;
      if (isScrolledAtBottom(metrics) && scrollDown && !metrics.atEnd) {
        this.armBoundary('next', BOUNDARY_DELTA_CAP_PX);
      } else if (isScrolledAtTop(metrics) && scrollUp && !metrics.atStart) {
        this.armBoundary('prev', BOUNDARY_DELTA_CAP_PX);
      }
    };

    const onWheel = (event: Event) => {
      if (this.boundaryNavLock) return;
      const metrics = this.readScrollMetrics();
      if (!metrics?.scrolled) return;
      const wheel = event as WheelEvent;
      this.maybePrefetchAdjacentSections(metrics);
      if (wheel.deltaY > 0 && isScrolledAtBottom(metrics) && !metrics.atEnd) {
        // Swallow the wheel so the browser doesn't rubber-band while we arm.
        wheel.preventDefault();
        // Real deltaY, capped, so one giant mouse-wheel tick can't skip the hint.
        this.armBoundary('next', Math.min(Math.abs(wheel.deltaY), BOUNDARY_DELTA_CAP_PX));
      } else if (wheel.deltaY < 0 && isScrolledAtTop(metrics) && !metrics.atStart) {
        wheel.preventDefault();
        this.armBoundary('prev', Math.min(Math.abs(wheel.deltaY), BOUNDARY_DELTA_CAP_PX));
      }
    };

    // Wheel intent is read from the scroll renderer's metrics, so listen only
    // on that node. Attaching the same handler on view/boundaryHost as well
    // fired once per capture phase hop and triple-armed boundary state (#121).
    const wheelOpts: AddEventListenerOptions = { passive: false, capture: true };
    renderer.addEventListener('scroll', onScroll);
    renderer.addEventListener('wheel', onWheel, wheelOpts);
    this.boundaryCleanups.push(() => {
      renderer.removeEventListener?.('scroll', onScroll);
      renderer.removeEventListener?.('wheel', onWheel, wheelOpts);
    });
    this.scrolledBoundaryBridgeEnabled = true;
    this.resetScrollBoundaryTracking();
  }

  private disableScrolledBoundaryBridge(): void {
    if (!this.scrolledBoundaryBridgeEnabled) return;
    for (const cleanup of this.boundaryCleanups.splice(0)) cleanup();
    this.scrolledBoundaryBridgeEnabled = false;
    this.lastScrollStart = 0;
    this.clearBoundaryArm();
  }

  /**
   * Accumulate scroll intent at a chapter edge. Each call adds `delta` (real
   * |deltaY|, capped by the caller) and emits the current arm progress so the
   * UI can show a hint. The chapter turns only once BOTH conditions hold:
   *   1. accumulated intent reaches `BOUNDARY_ARM_THRESHOLD_PX`, AND
   *   2. the hint has been visible for at least `BOUNDARY_ARM_MIN_VISIBLE_MS`.
   * The min-visible gate is the fix for the "hint flashes and vanishes" bug:
   * macOS fires 10–30 wheel events per gesture within ~50ms, so without it the
   * threshold was crossed in the same frame the hint first painted.
   *
   * Stopping for `BOUNDARY_ARM_DECAY_MS` disarms and hides the hint.
   */
  private armBoundary(direction: BoundaryArmDirection, delta: number): void {
    if (this.boundaryNavLock) return;
    if (this.armDirection !== direction) {
      this.armDirection = direction;
      this.armAccumulated = 0;
      this.armShownAt = 0;
    }
    this.armAccumulated += Math.max(0, delta);
    if (this.armShownAt === 0) this.armShownAt = Date.now();

    if (this.armDecayTimer) clearTimeout(this.armDecayTimer);
    this.armDecayTimer = setTimeout(() => this.decayBoundaryArm(), BOUNDARY_ARM_DECAY_MS);

    const progress = Math.min(1, this.armAccumulated / BOUNDARY_ARM_THRESHOLD_PX);
    this.bridge.emit('boundaryarm', {
      direction: this.armDirection,
      progress,
      armed: true,
    } satisfies BoundaryArmState);

    const reachedThreshold = this.armAccumulated >= BOUNDARY_ARM_THRESHOLD_PX;
    const visibleLongEnough = Date.now() - this.armShownAt >= BOUNDARY_ARM_MIN_VISIBLE_MS;
    if (reachedThreshold && visibleLongEnough) {
      const turnDirection = this.armDirection;
      this.clearBoundaryArm();
      void this.advanceAtBoundary(turnDirection);
    }
  }

  private decayBoundaryArm(): void {
    this.armDecayTimer = null;
    this.armDirection = null;
    this.armAccumulated = 0;
    this.armShownAt = 0;
    this.bridge.emit('boundaryarm', { direction: null, progress: 0, armed: false } satisfies BoundaryArmState);
  }

  private clearBoundaryArm(): void {
    if (this.armDecayTimer) {
      clearTimeout(this.armDecayTimer);
      this.armDecayTimer = null;
    }
    this.armDirection = null;
    this.armAccumulated = 0;
    this.armShownAt = 0;
    this.bridge.emit('boundaryarm', { direction: null, progress: 0, armed: false } satisfies BoundaryArmState);
  }

  private async advanceAtBoundary(
    direction: 'next' | 'prev',
    metrics = this.readScrollMetrics(),
  ): Promise<void> {
    if (this.boundaryNavLock || !metrics?.scrolled) return;
    if (direction === 'next') {
      if (metrics.atEnd || !isScrolledAtBottom(metrics)) return;
      this.boundaryNavLock = true;
      try {
        await this.view.next();
      } finally {
        this.boundaryNavLock = false;
        this.resetScrollBoundaryTracking();
      }
      return;
    }
    if (metrics.atStart || !isScrolledAtTop(metrics)) return;
    this.boundaryNavLock = true;
    try {
      await this.view.prev();
    } finally {
      this.boundaryNavLock = false;
      this.resetScrollBoundaryTracking();
    }
  }

  private maybePrefetchAdjacentSections(metrics: PaginatorScrollMetrics): void {
    const index = this.view.lastLocation?.index;
    const sections = this.view.book?.sections;
    if (index == null || !sections?.length) return;

    const { prefetchNext, prefetchPrev } = shouldPrefetchAdjacentSections(metrics);
    if (prefetchNext) {
      const nextIndex = findAdjacentLinearSectionIndex(sections, index, 1);
      if (nextIndex != null) this.prefetchSection(sections, nextIndex);
    }
    if (prefetchPrev) {
      const prevIndex = findAdjacentLinearSectionIndex(sections, index, -1);
      if (prevIndex != null) this.prefetchSection(sections, prevIndex);
    }
  }

  private prefetchSection(sections: FoliateSection[], index: number): void {
    if (this.prefetchedSectionIndices.has(index)) return;
    const createDocument = sections[index]?.createDocument;
    if (!createDocument) return;
    this.prefetchedSectionIndices.add(index);
    void createDocument().catch(() => {
      this.prefetchedSectionIndices.delete(index);
    });
  }

  private toEpubLocation(location?: FoliateLocation): unknown {
    const cfi = location?.cfi ?? '';
    const percentage = typeof location?.fraction === 'number' ? location.fraction : 0;
    return {
      start: {
        cfi,
        href: location?.tocItem?.href,
        label: location?.tocItem?.label,
        index: location?.index,
        percentage,
        sectionFraction: this.sectionFraction,
      },
      end: { cfi, percentage },
    };
  }

  private attachSelectionListener(doc?: Document, index?: number): void {
    if (!doc) return;

    let hasSelection = false;
    let previewFrame = 0;

    const getActiveSelection = () => {
      const selection = doc.defaultView?.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
      const text = selection.toString().trim();
      if (!text) return null;
      return selection;
    };

    const emitPreview = () => {
      const selection = getActiveSelection();
      if (!selection) {
        if (hasSelection) {
          hasSelection = false;
          this.bridge.emit('selectionCleared');
        }
        return;
      }

      hasSelection = true;
      this.bridge.emit('selected', '', { window: doc.defaultView, document: doc });
    };

    const schedulePreview = () => {
      if (previewFrame) return;
      previewFrame = doc.defaultView?.requestAnimationFrame(() => {
        previewFrame = 0;
        emitPreview();
      }) ?? 0;
    };

    const emitCommit = () => {
      const selection = getActiveSelection();
      if (!selection) {
        if (hasSelection) {
          hasSelection = false;
          this.bridge.emit('selectionCleared');
        }
        return;
      }

      hasSelection = true;
      const range = selection.getRangeAt(0);
      const cfi = typeof index === 'number' ? this.view.getCFI?.(index, range) ?? '' : '';
      this.bridge.emit('selected', cfi, { window: doc.defaultView, document: doc });
    };

    doc.addEventListener('selectionchange', schedulePreview);
    doc.addEventListener('mouseup', emitCommit);
    doc.addEventListener('touchend', emitCommit);
    doc.addEventListener('keyup', emitCommit);
    this.selectionCleanups.push(() => {
      if (previewFrame) doc.defaultView?.cancelAnimationFrame(previewFrame);
      doc.removeEventListener('selectionchange', schedulePreview);
      doc.removeEventListener('mouseup', emitCommit);
      doc.removeEventListener('touchend', emitCommit);
      doc.removeEventListener('keyup', emitCommit);
    });
  }

  private applyTheme(): void {
    const css = composeFoliateThemeCss(this.themeStyles, this.fontFaceCss);
    applyFoliateManagedStyles(this.view.renderer, css);
    for (const content of this.getContents()) this.applyThemeToDocument(content.document, css);
  }

  private applyThemeToDocument(
    doc?: Document,
    css: FoliateManagedCss = composeFoliateThemeCss(this.themeStyles, this.fontFaceCss),
  ): void {
    if (!doc) return;
    if (!this.view.renderer?.setStyles) {
      const id = 'creader-foliate-theme';
      let style = doc.getElementById(id) as HTMLStyleElement | null;
      if (!style) {
        style = doc.createElement('style');
        style.id = id;
        doc.head.append(style);
      }
      style.textContent = Array.isArray(css) ? `${css[0]}\n${css[1]}` : css;
    }

    const bodyBackground = this.themeStyles.body?.background;
    const bgColor = bodyBackground?.replace(/\s*!important\s*$/, '');
    if (bgColor) doc.documentElement.style.setProperty('--theme-bg-color', bgColor);

    const token = ++this.sectionTypographyToken;
    void this.finishSectionReadingTypography(doc, token);
  }

  private async finishSectionReadingTypography(doc: Document, token: number): Promise<void> {
    ensureSectionFontFaces(doc, this.fontFaceCss);
    try {
      await ensureDocumentReadingFonts(doc);
    } catch {
      // CSS @font-face fallback remains in ensureSectionFontFaces.
    }
    if (token !== this.sectionTypographyToken) return;

    stripPublisherTypographyOverrides(doc);

    const typographyId = 'creader-foliate-typography';
    let typographyStyle = doc.getElementById(typographyId) as HTMLStyleElement | null;
    if (!typographyStyle) {
      typographyStyle = doc.createElement('style');
      typographyStyle.id = typographyId;
      doc.head.append(typographyStyle);
    }
    const lang = resolveSectionLanguage(doc, this.bookLanguageHint);
    const fontStack = resolveFontStackForLanguage(lang);
    typographyStyle.textContent = buildSectionReadingCss(lang, fontStack, this.readingFontSize);
    forceReadingTypography(doc, fontStack, this.readingFontSize, { lang });
    await doc.fonts?.ready?.catch(() => undefined);
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
    layout: true,
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
    const bookLanguage = view.book?.metadata?.language?.[0] ?? '';
    rendition.setBookLanguageHint(bookLanguage);

    return {
      name: 'foliate',
      rendition,
      toc: toNavItems(view.book?.toc),
      destroy: () => rendition.destroy(),
    };
  },
};
