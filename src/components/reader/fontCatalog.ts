import { isCjkLang } from '../../services/reader/epubTypography';

export type BuiltinFontFamilyKey = 'builtin-roboto';

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

export const FIXED_FONT_FAMILY_KEY = 'builtin-roboto' satisfies BuiltinFontFamilyKey;

const SYSTEM_SANS_FALLBACK =
  '-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

/** Latin-first mixed stack for western sections. */
export const WESTERN_READING_FONT_STACK =
  `"CReader Roboto", "CReader LXGW WenKai", ${SYSTEM_SANS_FALLBACK}`;

/** CJK-first mixed stack for Chinese / Japanese / Korean sections. */
export const CJK_READING_FONT_STACK =
  `"CReader LXGW WenKai", "CReader Roboto", ${SYSTEM_SANS_FALLBACK}`;

/** Single fixed reading font: Roboto + LXGW mixed stack with bundled faces. */
export const BUILTIN_FONT_DEFINITION: BuiltinFontDefinition = {
  key: FIXED_FONT_FAMILY_KEY,
  label: 'Roboto',
  fontFamily: 'CReader Roboto',
  fontStack: WESTERN_READING_FONT_STACK,
  faces: [
    { resourceFile: 'fonts/Roboto-Regular.woff2', fontStyle: 'normal' },
    { resourceFile: 'fonts/Roboto-Italic.woff2', fontStyle: 'italic' },
    {
      resourceFile: 'fonts/LXGWWenKaiGBScreen-Subset.woff2',
      fontStyle: 'normal',
      fontFamily: 'CReader LXGW WenKai',
    },
  ],
};

export function isBuiltinFontFamilyKey(value: string): value is BuiltinFontFamilyKey {
  return value === FIXED_FONT_FAMILY_KEY;
}

/** Resolve the fixed mixed reading font stack. */
export function resolveFontStack(): string {
  return BUILTIN_FONT_DEFINITION.fontStack;
}

/** Pick a reading stack with the dominant script face first. */
export function resolveFontStackForLanguage(lang: string): string {
  return isCjkLang(lang) ? CJK_READING_FONT_STACK : WESTERN_READING_FONT_STACK;
}

export function getBuiltinFontDefinition(key: string): BuiltinFontDefinition | undefined {
  return isBuiltinFontFamilyKey(key) ? BUILTIN_FONT_DEFINITION : undefined;
}
