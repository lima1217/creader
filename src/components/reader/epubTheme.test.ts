import { describe, expect, it } from 'vitest';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { applyEpubTheme } from './epubTheme';
import { paperBodyPalette } from '../../theme/paperTheme';

/**
 * `applyEpubTheme` injects literal palette values (the book body cannot see the
 * host `:root` tokens), so the contract under test is: every body color equals
 * the matching `paperBodyPalette` entry for the active theme. The body
 * background stays opaque so it covers the engine document's default canvas (which
 * would otherwise wash out dark-mode text). Assertions read from
 * `paperBodyPalette` rather than hard-coded strings, so a future palette edit
 * only touches `paperTheme.ts` and these tests stay green.
 */
function captureThemeDefault() {
  const captured: Record<string, Record<string, string>> = {};
  const rendition = {
    themes: {
      default: (styles: Record<string, Record<string, string>>) => {
        Object.assign(captured, styles);
      },
    },
  } as unknown as ReaderRendition;
  return { rendition, captured };
}

const baseOptions = { fontFamily: 'Georgia', fontSize: 16, lineHeight: 1.6 };

describe('applyEpubTheme', () => {
  it('uses the current app page colors for the isolated book body document', () => {
    expect(paperBodyPalette.light.background).toBe('#FBF9F4');
    expect(paperBodyPalette.light.text).toBe('#2B2B2B');
    expect(paperBodyPalette.light.link).toBe('#33526E');
    expect(paperBodyPalette.dark.background).toBe('#1A1B1E');
    expect(paperBodyPalette.dark.text).toBe('#D4D4D4');
    expect(paperBodyPalette.dark.link).toBe('#7EB0E0');
  });

  it('injects the light palette into body, paragraph, headings, and link', () => {
    const { rendition, captured } = captureThemeDefault();

    applyEpubTheme(rendition, { ...baseOptions, theme: 'light' });

    expect(captured.body.color).toBe(`${paperBodyPalette.light.text} !important`);
    expect(captured.body.background).toBe(`${paperBodyPalette.light.background} !important`);
    expect(captured.a.color).toBe(`${paperBodyPalette.light.link} !important`);
    expect(captured['p'].color).toBe(`${paperBodyPalette.light.text} !important`);
    expect(captured['h1, h2, h3, h4, h5, h6'].color).toBe(`${paperBodyPalette.light.text} !important`);
    expect(captured['span, div'].color).toBe(`${paperBodyPalette.light.text} !important`);
  });

  it('injects the dark palette so book text/links match chrome in dark mode', () => {
    const { rendition, captured } = captureThemeDefault();

    applyEpubTheme(rendition, { ...baseOptions, theme: 'dark' });

    expect(captured.body.color).toBe(`${paperBodyPalette.dark.text} !important`);
    expect(captured.body.background).toBe(`${paperBodyPalette.dark.background} !important`);
    expect(captured.a.color).toBe(`${paperBodyPalette.dark.link} !important`);
  });

  // Regression guard: the body background must stay opaque. The engine renders
  // each section in an isolated document whose default canvas is white; an opaque body
  // background is what covers that white so dark-mode text stays legible. (A
  // prior fix made the body transparent to dodge foliate's stale background
  // snapshot, which exposed the iframe white and washed out dark-mode text.)
  it('keeps the body background opaque to cover the engine document canvas', () => {
    const { rendition, captured } = captureThemeDefault();

    applyEpubTheme(rendition, { ...baseOptions, theme: 'dark' });

    expect(captured.body.background).not.toBe('transparent !important');
    expect(captured.body.background).toBe(`${paperBodyPalette.dark.background} !important`);
  });

  it('keeps reader-driven typography settings untouched by the palette bridge', () => {
    const { rendition, captured } = captureThemeDefault();

    applyEpubTheme(rendition, { fontFamily: 'Merriweather', fontSize: 20, lineHeight: 1.8, theme: 'dark' });

    expect(captured.body['font-family']).toBe('Merriweather, Georgia, serif');
    expect(captured.body['font-size']).toBe('20px');
    expect(captured.body['line-height']).toBe('1.8');
    expect(captured.body.padding).toBe('20px !important');
    expect(captured.body.margin).toBe('0 auto !important');
  });
});
