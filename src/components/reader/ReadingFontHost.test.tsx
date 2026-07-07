import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadingFontHost } from './ReadingFontHost';
import { resolveFontStack } from './fontCatalog';

vi.mock('./useFontFaceCss', () => ({
  useFontFaceCss: () => '@font-face { font-family: "CReader Roboto"; font-display: swap; }',
}));

describe('ReadingFontHost', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    document.documentElement.style.removeProperty('--font-sans');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    document.documentElement.style.removeProperty('--font-sans');
  });

  it('injects bundled @font-face rules into the host document', () => {
    flushSync(() => root.render(<ReadingFontHost />));

    const style = document.querySelector('style[data-creader-reading-fonts]');
    expect(style?.textContent).toContain('CReader Roboto');
  });

  it('sets --font-sans to the fixed reading stack', () => {
    flushSync(() => root.render(<ReadingFontHost />));

    expect(document.documentElement.style.getPropertyValue('--font-sans'))
      .toBe(resolveFontStack());
  });
});
