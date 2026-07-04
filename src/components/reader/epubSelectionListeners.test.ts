import { describe, expect, it, vi } from 'vitest';
import { getSelectionPosition } from './epubSelectionListeners';

describe('getSelectionPosition', () => {
  it('lifts the iframe-local range rect into top-page coordinates via win.frameElement', () => {
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
      frameElement: iframe,
      innerWidth: 1280,
    } as unknown as Window;

    const position = getSelectionPosition(win);

    expect(position).toEqual({ x: 180, y: 120 });
  });

  it('returns null when the selection is empty', () => {
    const selection = {
      rangeCount: 0,
      getRangeAt: () => null,
      toString: () => '',
    } as unknown as Selection;

    const win = {
      getSelection: () => selection,
      frameElement: null,
    } as unknown as Window;

    expect(getSelectionPosition(win)).toBeNull();
  });

  it('returns null when the host iframe is unreachable (cross-origin)', () => {
    const selection = {
      rangeCount: 1,
      getRangeAt: () => ({ getBoundingClientRect: () => ({ width: 10, height: 10 }) } as Range),
      toString: () => 'some text',
    } as unknown as Selection;

    const win = {
      getSelection: () => selection,
      frameElement: null, // cross-origin iframes report null
    } as unknown as Window;

    expect(getSelectionPosition(win)).toBeNull();
  });
});
