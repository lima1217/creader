export type FontFamilyKey =
  | 'system'
  | 'serif-cjk'
  | 'sans-cjk'
  | 'serif-latin'
  | 'sans-latin';

export interface FontCatalogEntry {
  key: FontFamilyKey;
  label: string;
  fontStack: string;
}

export const FONT_CATALOG: readonly FontCatalogEntry[] = [
  {
    key: 'system',
    label: '系统默认',
    fontStack: 'system-ui, -apple-system, "PingFang SC", sans-serif',
  },
  {
    key: 'serif-cjk',
    label: '衬线（中文）',
    fontStack: '"Songti SC", "Source Han Serif SC", Georgia, serif',
  },
  {
    key: 'sans-cjk',
    label: '黑体（中文）',
    fontStack: '"PingFang SC", "Source Han Sans SC", "Helvetica Neue", sans-serif',
  },
  {
    key: 'serif-latin',
    label: '西文衬线',
    fontStack: 'Georgia, "Times New Roman", serif',
  },
  {
    key: 'sans-latin',
    label: '西文无衬线',
    fontStack: '"Helvetica Neue", Arial, sans-serif',
  },
] as const;

const FONT_STACK_BY_KEY = new Map(
  FONT_CATALOG.map((entry) => [entry.key, entry.fontStack]),
);

const LEGACY_FONT_FAMILY: Record<string, FontFamilyKey> = {
  Georgia: 'serif-latin',
};

const DEFAULT_FONT_FAMILY_KEY: FontFamilyKey = 'serif-latin';

export function isFontFamilyKey(value: string): value is FontFamilyKey {
  return FONT_STACK_BY_KEY.has(value as FontFamilyKey);
}

/** Coerce persisted settings to a catalog key (migrates legacy CSS literals). */
export function normalizeFontFamilyKey(stored: string): FontFamilyKey {
  if (isFontFamilyKey(stored)) return stored;
  return LEGACY_FONT_FAMILY[stored] ?? DEFAULT_FONT_FAMILY_KEY;
}

/** Resolve a catalog key (or legacy value) to a full CSS font-family stack. */
export function resolveFontStack(keyOrLegacy: string): string {
  return FONT_STACK_BY_KEY.get(normalizeFontFamilyKey(keyOrLegacy))!;
}
