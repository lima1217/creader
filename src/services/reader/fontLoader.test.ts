import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomFontEntry } from '../../types';
import { clearFontFaceCache, resolveFontFaceCss } from './fontLoader';

const readBundledFontBase64 = vi.fn();
const readFontFileBase64 = vi.fn();

vi.mock('./fontFileService', () => ({
  readBundledFontBase64: (...args: unknown[]) => readBundledFontBase64(...args),
  readFontFileBase64: (...args: unknown[]) => readFontFileBase64(...args),
}));

const customFonts: CustomFontEntry[] = [
  { id: 'cf_test', label: 'My Font', path: '/Users/me/fonts/MyFont.woff2' },
];

describe('fontLoader', () => {
  beforeEach(() => {
    clearFontFaceCache();
    readBundledFontBase64.mockReset();
    readFontFileBase64.mockReset();
    readBundledFontBase64.mockResolvedValue({
      bytesBase64: 'YmFzZTY0',
      mimeType: 'font/woff2',
    });
    readFontFileBase64.mockResolvedValue({
      bytesBase64: 'Y3VzdG9t',
      mimeType: 'font/woff2',
    });
  });

  it('returns empty css for whitelist fonts', async () => {
    await expect(resolveFontFaceCss('serif-latin', customFonts)).resolves.toBe('');
    expect(readBundledFontBase64).not.toHaveBeenCalled();
    expect(readFontFileBase64).not.toHaveBeenCalled();
  });

  it('loads bundled faces for builtin fonts', async () => {
    const css = await resolveFontFaceCss('builtin-roboto', customFonts);

    expect(readBundledFontBase64).toHaveBeenCalledTimes(3);
    expect(css).toContain('CReader Roboto');
    expect(css).toContain('CReader LXGW WenKai');
    expect(css).toContain('font-style: italic');
  });

  it('loads custom fonts from disk via Tauri', async () => {
    const css = await resolveFontFaceCss('custom:cf_test', customFonts);

    expect(readFontFileBase64).toHaveBeenCalledWith('/Users/me/fonts/MyFont.woff2');
    expect(css).toContain('CReader Custom cf_test');
  });

  it('caches repeated loads for the same key', async () => {
    await resolveFontFaceCss('builtin-roboto', customFonts);
    await resolveFontFaceCss('builtin-roboto', customFonts);

    expect(readBundledFontBase64).toHaveBeenCalledTimes(3);
  });
});
