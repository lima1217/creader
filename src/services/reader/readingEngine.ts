import type { Book as AppBook, NavItem } from '../../types';
import type { ReaderRendition, RenditionContent } from './epubAdapter';

export type ReadingEngineName = 'foliate';

export interface ReadingEngineRendition extends ReaderRendition {
  engineName?: ReadingEngineName;
  currentLocation?: () => unknown;
  getContents?: () => RenditionContent[];
  destroy?: () => void;
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
    searchLocatorNavigation: boolean;
    theme: boolean;
    cfi: 'epub-cfi' | 'synthetic-cfi' | 'none';
  };
  open(options: ReadingEngineOptions): Promise<ReadingEngineInstance>;
}
