import type { CustomFontEntry } from '../../types';

export type WhitelistFontFamilyKey =
  | 'system'
  | 'serif-cjk'
  | 'sans-cjk'
  | 'serif-latin'
  | 'sans-latin';

export type BuiltinFontFamilyKey = 'builtin-bitter' | 'builtin-lxgw-wenkai';

export type FontFamilyKey = WhitelistFontFamilyKey | BuiltinFontFamilyKey | `custom:${string}`;

export interface FontCatalogEntry {
  key: string;
  label: string;
  fontStack: string;
}

export interface BuiltinFontDefinition {
  key: BuiltinFontFamilyKey;
  label: string;
  fontFamily: string;
  fontStack: string;
  faces: readonly {
    resourceFile: string;
    fontStyle: 'normal' | 'italic';
  }[];
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

export const BUILTIN_FONT_DEFINITIONS: readonly BuiltinFontDefinition[] = [
  {
    key: 'builtin-bitter',
    label: 'Bitter（内置西文衬线）',
    fontFamily: 'CReader Bitter',
    fontStack: '"CReader Bitter", Georgia, "Times New Roman", serif',
    faces: [
      { resourceFile: 'fonts/Bitter-Regular.woff2', fontStyle: 'normal' },
      { resourceFile: 'fonts/Bitter-Italic.woff2', fontStyle: 'italic' },
    ],
  },
  {
    key: 'builtin-lxgw-wenkai',
    label: '霞鹜文楷（内置中文）',
    fontFamily: 'CReader LXGW WenKai',
    fontStack: '"CReader LXGW WenKai", "Songti SC", "Source Han Serif SC", serif',
    faces: [
      { resourceFile: 'fonts/LXGWWenKaiGBScreen-Subset.woff2', fontStyle: 'normal' },
    ],
  },
] as const;

const WHITELIST_STACK_BY_KEY = new Map(
  FONT_CATALOG.map((entry) => [entry.key, entry.fontStack]),
);

const BUILTIN_BY_KEY = new Map(
  BUILTIN_FONT_DEFINITIONS.map((entry) => [entry.key, entry]),
);

const LEGACY_FONT_FAMILY: Record<string, WhitelistFontFamilyKey> = {
  Georgia: 'serif-latin',
};

const DEFAULT_FONT_FAMILY_KEY: WhitelistFontFamilyKey = 'serif-latin';

export const CUSTOM_FONT_KEY_PREFIX = 'custom:';

export function isWhitelistFontFamilyKey(value: string): value is WhitelistFontFamilyKey {
  return WHITELIST_STACK_BY_KEY.has(value as WhitelistFontFamilyKey);
}

export function isBuiltinFontFamilyKey(value: string): value is BuiltinFontFamilyKey {
  return BUILTIN_BY_KEY.has(value as BuiltinFontFamilyKey);
}

export function isCustomFontFamilyKey(value: string): value is `custom:${string}` {
  return value.startsWith(CUSTOM_FONT_KEY_PREFIX) && value.length > CUSTOM_FONT_KEY_PREFIX.length;
}

export function customFontFamilyKey(id: string): `custom:${string}` {
  return `${CUSTOM_FONT_KEY_PREFIX}${id}`;
}

export function customFontFamilyName(id: string): string {
  return `CReader Custom ${id}`;
}

export function getCustomFontId(key: string): string | null {
  if (!isCustomFontFamilyKey(key)) return null;
  return key.slice(CUSTOM_FONT_KEY_PREFIX.length);
}

export function listFontCatalogEntries(customFonts: readonly CustomFontEntry[] = []): FontCatalogEntry[] {
  const builtinEntries = BUILTIN_FONT_DEFINITIONS.map(({ key, label, fontStack }) => ({
    key,
    label,
    fontStack,
  }));
  const customEntries = customFonts.map((entry) => ({
    key: customFontFamilyKey(entry.id),
    label: entry.label,
    fontStack: customFontStack(entry),
  }));
  return [...FONT_CATALOG, ...builtinEntries, ...customEntries];
}

export function customFontStack(entry: CustomFontEntry): string {
  const family = customFontFamilyName(entry.id);
  return `"${family}", Georgia, "Times New Roman", serif`;
}

/** Coerce persisted settings to a catalog key (migrates legacy CSS literals). */
export function normalizeFontFamilyKey(
  stored: string,
  customFonts: readonly CustomFontEntry[] = [],
): string {
  if (isWhitelistFontFamilyKey(stored)) return stored;
  if (isBuiltinFontFamilyKey(stored)) return stored;
  if (isCustomFontFamilyKey(stored)) {
    const id = getCustomFontId(stored);
    if (id && customFonts.some((entry) => entry.id === id)) return stored;
  }
  return LEGACY_FONT_FAMILY[stored] ?? DEFAULT_FONT_FAMILY_KEY;
}

/** Resolve a catalog key (or legacy value) to a full CSS font-family stack. */
export function resolveFontStack(
  keyOrLegacy: string,
  customFonts: readonly CustomFontEntry[] = [],
): string {
  const key = normalizeFontFamilyKey(keyOrLegacy, customFonts);
  if (isWhitelistFontFamilyKey(key)) {
    return WHITELIST_STACK_BY_KEY.get(key)!;
  }
  if (isBuiltinFontFamilyKey(key)) {
    return BUILTIN_BY_KEY.get(key)!.fontStack;
  }
  const customId = getCustomFontId(key);
  if (customId) {
    const entry = customFonts.find((font) => font.id === customId);
    if (entry) return customFontStack(entry);
  }
  return WHITELIST_STACK_BY_KEY.get(DEFAULT_FONT_FAMILY_KEY)!;
}

export function getBuiltinFontDefinition(key: string): BuiltinFontDefinition | undefined {
  if (!isBuiltinFontFamilyKey(key)) return undefined;
  return BUILTIN_BY_KEY.get(key);
}

export function fontFamilyNeedsInjection(
  keyOrLegacy: string,
  customFonts: readonly CustomFontEntry[] = [],
): boolean {
  const key = normalizeFontFamilyKey(keyOrLegacy, customFonts);
  return isBuiltinFontFamilyKey(key) || isCustomFontFamilyKey(key);
}
