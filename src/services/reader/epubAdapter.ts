export type RenditionContent = {
  window?: Window;
  document?: Document;
};

export type ReaderRendition = {
  themes: {
    default: (
      styles: Record<string, Record<string, string>>,
      options?: { fontFaceCss?: string },
    ) => void;
    register?: (
      name: string,
      styles: Record<string, Record<string, string>>,
      options?: { fontFaceCss?: string },
    ) => void;
    select?: (name?: string) => void;
  };
  display: (target?: string) => Promise<unknown> | void;
  prev: () => Promise<void> | void;
  next: () => Promise<void> | void;
  goToChapterStart?: () => Promise<void> | void;
  goToChapterEnd?: () => Promise<void> | void;
  seekToFraction?: (fraction: number) => Promise<void> | void;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  off: (event: string, callback: (...args: unknown[]) => void) => void;
  currentLocation?: () => unknown;
  destroy?: () => void;
  getContents?: () => RenditionContent[];
};

export function getRenditionContents(rendition: ReaderRendition): RenditionContent[] {
  return rendition.getContents?.() ?? [];
}
