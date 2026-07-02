export type ReaderSearchResult = {
  cfi: string;
  locator?: {
    kind: string;
    href: string;
    spineIndex: number;
    cfi?: string | null;
  };
  excerpt: string;
  section?: string;
  score?: number;
};
