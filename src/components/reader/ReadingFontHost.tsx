import { useEffect } from 'react';
import { resolveFontStack } from './fontCatalog';
import { useFontFaceCss } from './useFontFaceCss';

const READING_FONT_STACK = resolveFontStack();

/**
 * Mirrors the foliate section @font-face + font-family stack on the host
 * document so chrome and book body use the same reading fonts.
 */
export function ReadingFontHost() {
  const fontFaceCss = useFontFaceCss();

  useEffect(() => {
    document.documentElement.style.setProperty('--font-sans', READING_FONT_STACK);
    return () => {
      document.documentElement.style.removeProperty('--font-sans');
    };
  }, []);

  if (!fontFaceCss) return null;

  return <style data-creader-reading-fonts="">{fontFaceCss}</style>;
}
