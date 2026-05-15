import { describe, expect, it, vi } from 'vitest';
import { getSelectionFromEpubContent, setupEpubSelectionListeners } from './epubSelectionListeners';

function createFakeRendition(contents: Array<{ document?: Document; window?: Window }>) {
  const callbacks: Array<(content: { document?: Document; window?: Window }) => void> = [];
  return {
    rendition: {
      getContents: () => contents,
      hooks: {
        content: {
          register: (cb: (content: { document?: Document; window?: Window }) => void) => {
            callbacks.push(cb);
          },
        },
      },
    },
    callbacks,
  };
}

describe('epubSelectionListeners', () => {
  it('extracts selected text and positions it relative to the epub iframe', () => {
    const iframe = document.createElement('iframe');
    vi.spyOn(iframe, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 50,
      width: 500,
      height: 600,
      right: 600,
      bottom: 650,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    } as DOMRect);

    const range = {
      getBoundingClientRect: () => ({
        left: 20,
        top: 80,
        width: 120,
        height: 20,
        right: 140,
        bottom: 100,
        x: 20,
        y: 80,
        toJSON: () => ({}),
      }),
    } as Range;
    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => ' selected passage ',
    } as unknown as Selection;
    const win = {
      getSelection: () => selection,
    } as unknown as Window;

    const result = getSelectionFromEpubContent({
      win,
      iframe,
      lastMousePos: { x: 0, y: 0 },
    });

    expect(result?.text).toBe('selected passage');
    expect(result?.position).toEqual({ x: 180, y: 120 });
  });

  it('attaches selection listeners to already-rendered rendition contents', () => {
    vi.useFakeTimers();

    const selection = {
      toString: () => 'highlighted text',
    } as unknown as Selection;
    const epubWindow = {
      getSelection: () => selection,
      setTimeout: window.setTimeout.bind(window),
    } as unknown as Window;
    const epubDocument = document.implementation.createHTMLDocument('chapter');
    Object.defineProperty(epubDocument, 'defaultView', {
      configurable: true,
      value: epubWindow,
    });
    const { rendition } = createFakeRendition([{ document: epubDocument, window: epubWindow }]);
    const updateSelectionFromWindow = vi.fn();

    const cleanup = setupEpubSelectionListeners({
      rendition: rendition as never,
      containerRef: { current: document.createElement('div') },
      lastMousePosRef: { current: { x: 0, y: 0 } },
      startSelectionPolling: vi.fn(),
      updateSelectionFromWindow,
      setShowSelectionToolbar: vi.fn(),
    });

    epubDocument.dispatchEvent(new Event('selectionchange'));
    epubDocument.dispatchEvent(new MouseEvent('mouseup'));
    vi.runAllTimers();

    expect(updateSelectionFromWindow).toHaveBeenCalledWith(epubWindow);
    expect(updateSelectionFromWindow).toHaveBeenCalledTimes(2);

    cleanup();
    vi.useRealTimers();
  });
});
