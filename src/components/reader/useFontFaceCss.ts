import { useEffect, useState } from 'react';
import { FIXED_FONT_FAMILY_KEY } from './fontCatalog';
import { resolveFontFaceCss } from '../../services/reader/fontLoader';

export function useFontFaceCss(): string {
  const [fontFaceCss, setFontFaceCss] = useState('');

  useEffect(() => {
    let cancelled = false;
    setFontFaceCss('');

    void resolveFontFaceCss(FIXED_FONT_FAMILY_KEY)
      .then((css) => {
        if (!cancelled) setFontFaceCss(css);
      })
      .catch(() => {
        if (!cancelled) setFontFaceCss('');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return fontFaceCss;
}
