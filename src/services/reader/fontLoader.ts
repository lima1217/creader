import type { CustomFontEntry } from '../../types';
import {
  buildFontFaceCss,
  toFontDataUrl,
  type FontFaceRule,
} from './fontFace';
import {
  customFontFamilyName,
  fontFamilyNeedsInjection,
  getBuiltinFontDefinition,
  getCustomFontId,
  normalizeFontFamilyKey,
} from '../../components/reader/fontCatalog';
import { readBundledFontBase64, readFontFileBase64 } from './fontFileService';

const fontFaceCache = new Map<string, string>();
const inflightLoads = new Map<string, Promise<string>>();

function cacheKeyForFontFamilyKey(fontFamilyKey: string, customFonts: readonly CustomFontEntry[]): string {
  const customId = getCustomFontId(fontFamilyKey);
  if (!customId) return fontFamilyKey;
  const entry = customFonts.find((font) => font.id === customId);
  return entry ? `${fontFamilyKey}:${entry.path}` : fontFamilyKey;
}

async function loadFontFaceRules(
  fontFamilyKey: string,
  customFonts: readonly CustomFontEntry[],
): Promise<FontFaceRule[]> {
  const builtin = getBuiltinFontDefinition(fontFamilyKey);
  if (builtin) {
    const rules = await Promise.all(
      builtin.faces.map(async (face) => {
        const payload = await readBundledFontBase64(face.resourceFile);
        return {
          fontFamily: builtin.fontFamily,
          src: toFontDataUrl(payload.bytesBase64, payload.mimeType),
          fontWeight: '400',
          fontStyle: face.fontStyle,
        } satisfies FontFaceRule;
      }),
    );
    return rules;
  }

  const customId = getCustomFontId(fontFamilyKey);
  if (!customId) return [];

  const entry = customFonts.find((font) => font.id === customId);
  if (!entry) return [];

  const payload = await readFontFileBase64(entry.path);
  return [
    {
      fontFamily: customFontFamilyName(entry.id),
      src: toFontDataUrl(payload.bytesBase64, payload.mimeType),
      fontWeight: '400',
      fontStyle: 'normal',
    },
  ];
}

export function clearFontFaceCache(): void {
  fontFaceCache.clear();
  inflightLoads.clear();
}

export async function resolveFontFaceCss(
  fontFamilyKey: string,
  customFonts: readonly CustomFontEntry[] = [],
): Promise<string> {
  const normalizedKey = normalizeFontFamilyKey(fontFamilyKey, customFonts);
  if (!fontFamilyNeedsInjection(normalizedKey, customFonts)) {
    return '';
  }

  const cacheKey = cacheKeyForFontFamilyKey(normalizedKey, customFonts);
  const cached = fontFaceCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const inflight = inflightLoads.get(cacheKey);
  if (inflight) return inflight;

  const loadPromise = loadFontFaceRules(normalizedKey, customFonts)
    .then((rules) => {
      const css = buildFontFaceCss(rules);
      fontFaceCache.set(cacheKey, css);
      inflightLoads.delete(cacheKey);
      return css;
    })
    .catch((error) => {
      inflightLoads.delete(cacheKey);
      throw error;
    });

  inflightLoads.set(cacheKey, loadPromise);
  return loadPromise;
}
