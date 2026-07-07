import {
  buildFontFaceCss,
  toFontDataUrl,
  type FontFaceRule,
} from './fontFace';
import {
  FIXED_FONT_FAMILY_KEY,
  getBuiltinFontDefinition,
  type BuiltinFontFamilyKey,
} from '../../components/reader/fontCatalog';
import { readBundledFontBase64 } from './fontFileService';

const fontFaceCache = new Map<string, string>();
const inflightLoads = new Map<string, Promise<string>>();

async function loadFontFaceRules(
  fontFamilyKey: BuiltinFontFamilyKey,
): Promise<FontFaceRule[]> {
  const builtin = getBuiltinFontDefinition(fontFamilyKey);
  if (!builtin) return [];

  const rules = await Promise.all(
    builtin.faces.map(async (face) => {
      const payload = await readBundledFontBase64(face.resourceFile);
      return {
        fontFamily: face.fontFamily ?? builtin.fontFamily,
        src: toFontDataUrl(payload.bytesBase64, payload.mimeType),
        fontWeight: '400',
        fontStyle: face.fontStyle,
      } satisfies FontFaceRule;
    }),
  );
  return rules;
}

export function clearFontFaceCache(): void {
  fontFaceCache.clear();
  inflightLoads.clear();
}

export async function resolveFontFaceCss(
  fontFamilyKey: BuiltinFontFamilyKey = FIXED_FONT_FAMILY_KEY,
): Promise<string> {
  const cacheKey = fontFamilyKey;
  const cached = fontFaceCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const inflight = inflightLoads.get(cacheKey);
  if (inflight) return inflight;

  const loadPromise = loadFontFaceRules(fontFamilyKey)
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
