export type BuiltinFontFamilyKey = 'builtin-roboto' | 'builtin-lxgw-wenkai';

export interface BuiltinFontDefinition {
  key: BuiltinFontFamilyKey;
  label: string;
  fontFamily: string;
  fontStack: string;
  faces: readonly {
    resourceFile: string;
    fontStyle: 'normal' | 'italic';
    fontFamily?: string;
  }[];
}

export const BUILTIN_FONT_DEFINITIONS: readonly BuiltinFontDefinition[] = [
  {
    key: 'builtin-roboto',
    label: 'Roboto',
    fontFamily: 'CReader Roboto',
    fontStack:
      '"CReader Roboto", "CReader LXGW WenKai", -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
    faces: [
      { resourceFile: 'fonts/Roboto-Regular.woff2', fontStyle: 'normal' },
      { resourceFile: 'fonts/Roboto-Italic.woff2', fontStyle: 'italic' },
      {
        resourceFile: 'fonts/LXGWWenKaiGBScreen-Subset.woff2',
        fontStyle: 'normal',
        fontFamily: 'CReader LXGW WenKai',
      },
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

export const FIXED_FONT_FAMILY_KEY: BuiltinFontFamilyKey = 'builtin-roboto';

const BUILTIN_BY_KEY = new Map(
  BUILTIN_FONT_DEFINITIONS.map((entry) => [entry.key, entry]),
);

export function isBuiltinFontFamilyKey(value: string): value is BuiltinFontFamilyKey {
  return BUILTIN_BY_KEY.has(value as BuiltinFontFamilyKey);
}

/** Resolve a builtin catalog key to a full CSS font-family stack. */
export function resolveFontStack(
  key: BuiltinFontFamilyKey = FIXED_FONT_FAMILY_KEY,
): string {
  return BUILTIN_BY_KEY.get(key)!.fontStack;
}

export function getBuiltinFontDefinition(key: string): BuiltinFontDefinition | undefined {
  if (!isBuiltinFontFamilyKey(key)) return undefined;
  return BUILTIN_BY_KEY.get(key);
}
