import { useEffect } from 'react';
import type { Settings } from '../../types';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import type { ReadingEngineRendition } from '../../services/reader/readingEngine';
import { resolveFontStack } from './fontCatalog';
import { applyEpubTheme } from './epubTheme';
import { useFontFaceCss } from './useFontFaceCss';
import { DEFAULT_READING_LAYOUT } from '../../services/reader/readingEngine';

/**
 * Applies reader settings to a live rendition *without* re-displaying.
 *
 * Layout (flow / line measure / animated) and theme (book-body palette,
 * font family/size) are independent of position: foliate's paginator preserves
 * the scroll anchor (`#anchor`) across `setAttribute` on its observed
 * attributes and across `renderer.setStyles()`, so changing them does not
 * require a `display(cfi)` round-trip. Re-displaying here used to race the
 * engine's own reflow and cause a visible flash on every settings change
 * (#88); this hook is the regression guard for that — it must never call
 * `rendition.display(...)`.
 *
 * First-open layout is established by `useEpubBookLifecycle` before the initial
 * `display`; this effect only fires when a settings field actually changes.
 */
export function useEpubSettingsSync(
  renditionRef: React.RefObject<ReaderRendition | null>,
  settings: Settings,
): void {
  const fontFaceCss = useFontFaceCss(settings.fontFamily, settings.customFonts);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    // The layout is fixed (ADR-0021); re-applying the same value keeps the
    // engine pinned to it without touching position.
    (rendition as ReadingEngineRendition).setLayout?.(DEFAULT_READING_LAYOUT);

    applyEpubTheme(rendition, {
      theme: settings.theme,
      fontStack: resolveFontStack(settings.fontFamily, settings.customFonts),
      fontSize: settings.fontSize,
      fontFaceCss,
    });
    // Layout/theme only — intentionally no `display()`. `renditionRef` is a
    // stable mutable ref, so it is omitted from deps; the effect re-runs only
    // when a settings field that actually affects layout/theme changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.fontSize, settings.fontFamily, settings.customFonts, settings.theme, fontFaceCss]);
}
