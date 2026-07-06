import { useEffect, useState } from 'react';
import type { CustomFontEntry } from '../../types';
import { resolveFontFaceCss } from '../../services/reader/fontLoader';

function serializeCustomFonts(customFonts: readonly CustomFontEntry[]): string {
  return customFonts.map((entry) => `${entry.id}:${entry.path}`).join('|');
}

export function useFontFaceCss(
  fontFamily: string,
  customFonts: readonly CustomFontEntry[],
): string {
  const [fontFaceCss, setFontFaceCss] = useState('');
  const customFontsKey = serializeCustomFonts(customFonts);

  useEffect(() => {
    let cancelled = false;
    setFontFaceCss('');

    void resolveFontFaceCss(fontFamily, customFonts)
      .then((css) => {
        if (!cancelled) setFontFaceCss(css);
      })
      .catch(() => {
        if (!cancelled) setFontFaceCss('');
      });

    return () => {
      cancelled = true;
    };
  }, [fontFamily, customFontsKey]);

  return fontFaceCss;
}
