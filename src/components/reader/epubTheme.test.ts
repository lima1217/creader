import { describe, expect, it, vi } from 'vitest';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { applyEpubTheme } from './epubTheme';
import { paperBodyPalette } from '../../theme/paperTheme';

function captureThemeDefault() {
  const captured: {
    styles: Record<string, Record<string, string>>;
    options?: { fontFaceCss?: string; fontSize?: number };
  } = { styles: {} };
  const rendition = {
    themes: {
      default: (
        styles: Record<string, Record<string, string>>,
        options?: { fontFaceCss?: string; fontSize?: number },
      ) => {
        Object.assign(captured.styles, styles);
        captured.options = options;
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

    expect(captured.styles.body.color).toBe(`${paperBodyPalette.light.text} !important`);
    expect(captured.styles.body.background).toBe(`${paperBodyPalette.light.background} !important`);
    expect(captured.styles.a.color).toBe(`${paperBodyPalette.light.link} !important`);
    expect(captured.styles.body['font-family']).toBeUndefined();
    expect(captured.styles.body['font-size']).toBeUndefined();
  });

  it('forces paragraph spacing when override is enabled', () => {
    const { rendition, captured } = captureThemeDefault();

    applyEpubTheme(rendition, {
      ...baseOptions,
      theme: 'light',
      forceTypographyOverride: true,
    });

    expect(captured.styles.p).toEqual({ 'margin-bottom': '1em' });
  });

  it('injects the dark palette so book text/links match chrome in dark mode', () => {
    const { rendition, captured } = captureThemeDefault();

    applyEpubTheme(rendition, { ...baseOptions, theme: 'dark' });

    expect(captured.styles.body.color).toBe(`${paperBodyPalette.dark.text} !important`);
    expect(captured.styles.body.background).toBe(`${paperBodyPalette.dark.background} !important`);
    expect(captured.styles.a.color).toBe(`${paperBodyPalette.dark.link} !important`);
  });

  it('keeps the body background opaque to cover the engine document canvas', () => {
    const { rendition, captured } = captureThemeDefault();

    applyEpubTheme(rendition, { ...baseOptions, theme: 'dark' });

    expect(captured.styles.body.background).not.toBe('transparent !important');
    expect(captured.styles.body.background).toBe(`${paperBodyPalette.dark.background} !important`);
  });

  it('forwards font-face css and font size through themes.default', () => {
    const defaultTheme = vi.fn();
    const rendition = {
      themes: { default: defaultTheme },
    } as unknown as ReaderRendition;

    applyEpubTheme(rendition, {
      ...baseOptions,
      theme: 'light',
      fontFaceCss: '@font-face { font-family: "CReader Literata"; }',
      fontSize: 20,
    });

    expect(defaultTheme).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          color: `${paperBodyPalette.light.text} !important`,
        }),
      }),
      {
        fontFaceCss: '@font-face { font-family: "CReader Literata"; }',
        fontSize: 20,
      },
    );
  });
});
