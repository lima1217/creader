import type { Book, Rendition } from 'epubjs';

export type EpubLocations = {
  load?: (serialized: string) => Promise<void>;
  generate?: (charsPerPage: number) => Promise<void>;
  save?: () => string;
  length?: () => number;
  percentageFromCfi?: (cfi: string) => number;
};

export type EpubArchive = {
  getText?: (href: string) => Promise<string>;
  request?: (href: string, type: 'text') => Promise<string>;
};

export type EpubSpineItem = {
  href?: string;
  url?: string;
  idref?: string;
  label?: string;
  document?: Document;
  find?: (query: string) => Promise<Array<{ cfi?: string; excerpt?: string }>>;
  load?: (loader?: unknown) => Promise<Document | { body?: { textContent?: string } } | string | null>;
  unload?: () => void;
};

export type EpubSpine = {
  spineItems?: EpubSpineItem[];
  items?: EpubSpineItem[];
  length?: number;
  hooks?: {
    content?: {
      register?: (callback: (doc: Document, section?: EpubSpineItem) => void | Promise<void>) => void;
      deregister?: (callback: (doc: Document, section?: EpubSpineItem) => void | Promise<void>) => void;
    };
  };
};

export type EpubBookLike = Book & {
  locations?: EpubLocations;
  spine?: EpubSpine;
  archive?: EpubArchive;
  load?: (href: string) => Promise<unknown>;
};

export type RenditionContent = {
  window?: Window;
  document?: Document;
};

type RenditionWithExtras = Rendition & {
  getContents?: () => RenditionContent[];
  hooks?: {
    content?: {
      register?: (callback: (contents: RenditionContent) => void) => void;
    };
  };
  _selectionPollingInterval?: number | null;
};

export function getRenditionContents(rendition: Rendition): RenditionContent[] {
  return (rendition as RenditionWithExtras).getContents?.() ?? [];
}

export function registerRenditionContentHook(rendition: Rendition, callback: (contents: RenditionContent) => void): void {
  (rendition as RenditionWithExtras).hooks?.content?.register?.(callback);
}

export function setSelectionPollingInterval(rendition: Rendition, interval: number | null): void {
  (rendition as RenditionWithExtras)._selectionPollingInterval = interval;
}

export function getSelectionPollingInterval(rendition: Rendition): number | null | undefined {
  return (rendition as RenditionWithExtras)._selectionPollingInterval;
}
