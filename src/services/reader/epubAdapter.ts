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
};

export type EpubBookLike = {
  spine?: EpubSpine;
  archive?: EpubArchive;
  load?: (href: string) => Promise<unknown>;
  destroy?: () => void;
};

export type RenditionContent = {
  window?: Window;
  document?: Document;
};

export type ReaderRendition = {
  themes: {
    default: (styles: Record<string, Record<string, string>>) => void;
    register?: (name: string, styles: Record<string, Record<string, string>>) => void;
    select?: (name?: string) => void;
  };
  display: (target?: string) => Promise<unknown> | void;
  prev: () => Promise<void> | void;
  next: () => Promise<void> | void;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  off: (event: string, callback: (...args: unknown[]) => void) => void;
  currentLocation?: () => unknown;
  destroy?: () => void;
  getContents?: () => RenditionContent[];
  hooks?: {
    content?: {
      register?: (callback: (contents: RenditionContent) => void) => void;
    };
  };
  _selectionPollingInterval?: number | null;
};

export function getRenditionContents(rendition: ReaderRendition): RenditionContent[] {
  return rendition.getContents?.() ?? [];
}

export function registerRenditionContentHook(rendition: ReaderRendition, callback: (contents: RenditionContent) => void): void {
  rendition.hooks?.content?.register?.(callback);
}

export function setSelectionPollingInterval(rendition: ReaderRendition, interval: number | null): void {
  rendition._selectionPollingInterval = interval;
}

export function getSelectionPollingInterval(rendition: ReaderRendition): number | null | undefined {
  return rendition._selectionPollingInterval;
}
