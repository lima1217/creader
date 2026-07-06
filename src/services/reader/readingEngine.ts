import type { Book as AppBook, NavItem } from '../../types';
import type { ReaderRendition, RenditionContent } from './epubAdapter';

export type ReadingEngineName = 'foliate';

export interface ReadingLayoutOptions {
  flow: 'scrolled';
  maxInlineSize?: number;
  animated?: boolean;
}

/**
 * Fixed line measure for the reading surface (px). Single source of truth for
 * both the paginator's `max-inline-size` attribute and body typography width.
 * Re-exported from `epubTheme.ts` for body-typography consumers.
 */
export const EPUB_MAX_INLINE_SIZE = 760;

/**
 * The fixed reading layout (ADR-0021): always `flow=scrolled` with the shared
 * line measure and animated page transitions. Layout is not a user setting;
 * both first open and settings changes re-apply this same value so the engine
 * never drifts from it.
 *
 * The `animated` flag is the page-turn feel finalized by #93; keep the two call
 * sites pinned to this constant rather than passing inline literals.
 */
export const DEFAULT_READING_LAYOUT: ReadingLayoutOptions = {
  flow: 'scrolled',
  maxInlineSize: EPUB_MAX_INLINE_SIZE,
  animated: true,
};

export interface ReadingEngineRendition extends ReaderRendition {
  engineName?: ReadingEngineName;
  currentLocation?: () => unknown;
  getContents?: () => RenditionContent[];
  destroy?: () => void;
  setLayout?: (opts: ReadingLayoutOptions) => void;
  goToChapterStart?: () => Promise<void>;
  goToChapterEnd?: () => Promise<void>;
  seekToFraction?: (fraction: number) => Promise<void>;
  getSectionFractions?: () => number[];
}

export interface ReadingEngineInstance {
  name: ReadingEngineName;
  rendition: ReadingEngineRendition;
  toc: NavItem[];
  destroy(): void;
}

export interface ReadingEngineOptions {
  appBook: AppBook;
  arrayBuffer: ArrayBuffer;
  container: HTMLElement;
}

export interface ReadingEngineAdapter {
  name: ReadingEngineName;
  supports: {
    navigation: boolean;
    selection: boolean;
    progress: boolean;
    theme: boolean;
    layout: boolean;
    cfi: 'epub-cfi' | 'synthetic-cfi' | 'none';
  };
  open(options: ReadingEngineOptions): Promise<ReadingEngineInstance>;
}
