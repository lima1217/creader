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
const fontRulesCache = new Map<string, FontFaceRule[]>();
const inflightLoads = new Map<string, Promise<string>>();
const inflightRuleLoads = new Map<string, Promise<FontFaceRule[]>>();

async function loadFontFaceRules(
  fontFamilyKey: BuiltinFontFamilyKey,
): Promise<FontFaceRule[]> {
  const cached = fontRulesCache.get(fontFamilyKey);
  if (cached) return cached;

  const inflight = inflightRuleLoads.get(fontFamilyKey);
  if (inflight) return inflight;

  const loadPromise = (async () => {
    const builtin = getBuiltinFontDefinition(fontFamilyKey);
    if (!builtin) return [];

    const rules = await Promise.all(
      builtin.faces.map(async (face) => {
        const payload = await readBundledFontBase64(face.resourceFile);
        return {
          fontFamily: face.fontFamily ?? builtin.fontFamily,
          src: toFontDataUrl(payload.bytesBase64, payload.mimeType),
          fontWeight: face.fontWeight ?? '400',
          fontStyle: face.fontStyle,
        } satisfies FontFaceRule;
      }),
    );
    fontRulesCache.set(fontFamilyKey, rules);
    inflightRuleLoads.delete(fontFamilyKey);
    return rules;
  })().catch((error) => {
    inflightRuleLoads.delete(fontFamilyKey);
    throw error;
  });

  inflightRuleLoads.set(fontFamilyKey, loadPromise);
  return loadPromise;
}

export async function getFontFaceRules(
  fontFamilyKey: BuiltinFontFamilyKey = FIXED_FONT_FAMILY_KEY,
): Promise<FontFaceRule[]> {
  return loadFontFaceRules(fontFamilyKey);
}

/**
 * Register bundled reading fonts on a foliate section document. The FontFace
 * API is more reliable than huge data-URL blocks inside EPUB iframes.
 */
export async function ensureDocumentReadingFonts(
  doc: Document,
  fontFamilyKey: BuiltinFontFamilyKey = FIXED_FONT_FAMILY_KEY,
): Promise<void> {
  if (typeof FontFace === 'undefined') return;

  const rules = await getFontFaceRules(fontFamilyKey);
  if (!rules.length) return;

  await Promise.all(
    rules.map(async (rule) => {
      const loaded = [...doc.fonts].some(
        (face) =>
          face.family === rule.fontFamily &&
          face.style === (rule.fontStyle ?? 'normal') &&
          String(face.weight) === String(rule.fontWeight ?? '400'),
      );
      if (loaded) return;

      const face = new FontFace(
        rule.fontFamily,
        `url("${rule.src}")`,
        {
          weight: rule.fontWeight ?? '400',
          style: rule.fontStyle ?? 'normal',
          display: 'swap',
        },
      );
      await face.load();
      doc.fonts.add(face);
    }),
  );
}

export function clearFontFaceCache(): void {
  fontFaceCache.clear();
  fontRulesCache.clear();
  inflightLoads.clear();
  inflightRuleLoads.clear();
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
