import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFontFaceCache, resolveFontFaceCss } from './fontLoader';

const readBundledFontBase64 = vi.fn();

vi.mock('./fontFileService', () => ({
  readBundledFontBase64: (...args: unknown[]) => readBundledFontBase64(...args),
}));

describe('fontLoader', () => {
  beforeEach(() => {
    clearFontFaceCache();
    readBundledFontBase64.mockReset();
    readBundledFontBase64.mockResolvedValue({
      bytesBase64: 'YmFzZTY0',
      mimeType: 'font/woff2',
    });
  });

  it('loads bundled faces for builtin fonts', async () => {
    const css = await resolveFontFaceCss('builtin-roboto');

    expect(readBundledFontBase64).toHaveBeenCalledTimes(3);
    expect(css).toContain('CReader Roboto');
    expect(css).toContain('CReader LXGW WenKai');
    expect(css).toContain('font-style: italic');
  });

  it('caches repeated loads for the same key', async () => {
    await resolveFontFaceCss('builtin-roboto');
    await resolveFontFaceCss('builtin-roboto');

    expect(readBundledFontBase64).toHaveBeenCalledTimes(3);
  });
});
