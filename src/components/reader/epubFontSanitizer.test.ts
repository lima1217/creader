import { describe, it, expect, vi } from 'vitest';
import { setupEpubFontSanitizer } from './epubFontSanitizer';

function createFakeRendition() {
  const callbacks: Array<(contents: { document?: Document }) => void> = [];
  const rendition = {
    hooks: {
      content: {
        register: (cb: (contents: { document?: Document }) => void) => {
          callbacks.push(cb);
        },
      },
    },
  };
  return { rendition, callbacks };
}

describe('epubFontSanitizer', () => {
  it('removes @font-face rules with non-embedded font urls', () => {
    vi.useFakeTimers();

    const style = document.createElement('style');
    style.textContent = `
      @font-face {
        font-family: "PingFang SC";
        src: url(PingFang-SC-Regular.woff2) format("woff2");
      }
      body { color: red; }
    `;
    document.head.append(style);

    const { rendition, callbacks } = createFakeRendition();
    const cleanup = setupEpubFontSanitizer(rendition as unknown as never);
    callbacks[0]?.({ document });
    vi.runAllTimers();

    const sheet = style.sheet as CSSStyleSheet;
    const text = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
    expect(text).not.toMatch(/@font-face/i);
    expect(text).toMatch(/body\s*\{/i);

    cleanup();
    style.remove();
    vi.useRealTimers();
  });

  it('keeps @font-face rules that use embedded urls', () => {
    vi.useFakeTimers();

    const style = document.createElement('style');
    style.textContent = `
      @font-face {
        font-family: "Embedded Font";
        src: url("data:font/woff2;base64,AAAA") format("woff2");
      }
      body { color: red; }
    `;
    document.head.append(style);

    const { rendition, callbacks } = createFakeRendition();
    const cleanup = setupEpubFontSanitizer(rendition as unknown as never);
    callbacks[0]?.({ document });
    vi.runAllTimers();

    const sheet = style.sheet as CSSStyleSheet;
    const text = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
    expect(text).toMatch(/@font-face/i);

    cleanup();
    style.remove();
    vi.useRealTimers();
  });
});
