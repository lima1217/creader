import type { Rendition } from 'epubjs';
import type { Book as AppBook, NavItem } from '../../types';
import type { EpubBookLike, RenditionContent } from './epubAdapter';

export type ReadingEngineName = 'foliate' | 'epubjs';

export interface ReadingEngineRendition extends Rendition {
  engineName?: ReadingEngineName;
  currentLocation?: () => unknown;
  getContents?: () => RenditionContent[];
  destroy?: () => void;
}

export interface ReadingEngineInstance {
  name: ReadingEngineName;
  bookLike: EpubBookLike;
  rendition: ReadingEngineRendition;
  toc: NavItem[];
  locationsAvailable: boolean;
  destroy(): void;
}

export interface ReadingEngineOptions {
  appBook: AppBook;
  arrayBuffer: ArrayBuffer;
  container: HTMLElement;
  scriptsEnabled: boolean;
}

export interface ReadingEngineAdapter {
  name: ReadingEngineName;
  supports: {
    navigation: boolean;
    selection: boolean;
    progress: boolean;
    searchLocatorNavigation: boolean;
    theme: boolean;
    cfi: 'epub-cfi' | 'synthetic-cfi' | 'none';
  };
  open(options: ReadingEngineOptions): Promise<ReadingEngineInstance>;
}
