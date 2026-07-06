import { describe, expect, it } from 'vitest';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { applyEpubTheme, EPUB_LINE_HEIGHT } from './epubTheme';
import { paperBodyPalette } from '../../theme/paperTheme';

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

const baseOptions = { fontStack: 'Georgia, "Times New Roman", serif', fontSize: 16 };

describe('applyEpubTheme', () => {
  it('uses the current app page colors for the isolated book body document', () => {
    expect(paperBodyPalette.light.background).toBe('#F7F3EA');
    expect(paperBodyPalette.light.text).toBe('#2B2B2B');
    expect(paperBodyPalette.light.link).toBe('#33526E');
    expect(paperBodyPalette.dark.background).toBe('#1A1B1E');
    expect(paperBodyPalette.dark.text).toBe('#D4D4D4');
    expect(paperBodyPalette.dark.link).toBe('#7EB0E0');
  });

  it('injects palette colors on body and links only', () => {
    const { rendition, captured } = captureThemeDefault();

    applyEpubTheme(rendition, { ...baseOptions, theme: 'light' });

    expect(captured.body.color).toBe(`${paperBodyPalette.light.text} !important`);
    expect(captured.body.background).toBe(`${paperBodyPalette.light.background} !important`);
    expect(captured.a.color).toBe(`${paperBodyPalette.light.link} !important`);
    expect(captured.p).toEqual({ 'margin-bottom': '1em' });
    expect(captured['span, div']).toBeUndefined();
    expect(captured['h1, h2, h3, h4, h5, h6']).toBeUndefined();
  });

  it('injects the dark palette so book text/links match chrome in dark mode', () => {
    const { rendition, captured } = captureThemeDefault();

    applyEpubTheme(rendition, { ...baseOptions, theme: 'dark' });

    expect(captured.body.color).toBe(`${paperBodyPalette.dark.text} !important`);
    expect(captured.body.background).toBe(`${paperBodyPalette.dark.background} !important`);
    expect(captured.a.color).toBe(`${paperBodyPalette.dark.link} !important`);
  });

  it('keeps the body background opaque to cover the engine document canvas', () => {
    const { rendition, captured } = captureThemeDefault();

    applyEpubTheme(rendition, { ...baseOptions, theme: 'dark' });

    expect(captured.body.background).not.toBe('transparent !important');
    expect(captured.body.background).toBe(`${paperBodyPalette.dark.background} !important`);
  });

  it('uses fixed line height and font stack without padding', () => {
    const { rendition, captured } = captureThemeDefault();

    applyEpubTheme(rendition, {
      fontStack: 'Merriweather, Georgia, serif',
      fontSize: 20,
      theme: 'dark',
    });

    expect(captured.body['font-family']).toBe('Merriweather, Georgia, serif');
    expect(captured.body['font-size']).toBe('20px');
    expect(captured.body['line-height']).toBe(String(EPUB_LINE_HEIGHT));
    expect(captured.body.padding).toBeUndefined();
    expect(captured.body.margin).toBe('0 auto !important');
  });
});
