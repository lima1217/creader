import { describe, expect, it } from 'vitest';
import { sliceChapterContent } from './contextWindow';

describe('sliceChapterContent', () => {
  it('returns the full text when it fits within maxLen', () => {
    const result = sliceChapterContent('short', 100);
    expect(result).toEqual({ text: 'short', offset: 0, truncatedEnd: false });
  });

  it('slices from the start when no focus text is given', () => {
    const result = sliceChapterContent('abcdefghij', 4);
    expect(result.text).toBe('abcd');
    expect(result.offset).toBe(0);
    expect(result.truncatedEnd).toBe(true);
  });

  it('centers the window around the focus text', () => {
    const text = '0123456789';
    const result = sliceChapterContent(text, 4, '5678');
    // focusStart=5, focusMid=7; start=max(0, 7-2)=5, end=min(10, 9)=9
    expect(result.text).toBe('5678');
    expect(result.offset).toBe(5);
  });

  it('clamps the window start to 0 when focus is at the very head', () => {
    const text = '0123456789';
    const result = sliceChapterContent(text, 4, '01');
    // focusMid is at index 1; window start = max(0, 1 - 2) = 0, end = 4
    expect(result.text).toBe('0123');
    expect(result.offset).toBe(0);
  });

  it('symmetrically clamps so the slice stays maxLen near the tail', () => {
    // Regression (BUG-7): the focus sits near the chapter end. Before the
    // symmetric clamp, end stayed anchored to the initial start, so the slice
    // could come out shorter than maxLen. After the fix, end is re-clamped
    // after start moves, keeping the window exactly maxLen.
    const text = '0123456789';
    const result = sliceChapterContent(text, 4, '6789');
    // focusMid is at index 8; start = max(0, 8-2) = 6, end = min(10, 10) = 10
    expect(result.text.length).toBe(4);
    expect(result.text).toBe('6789');
    expect(result.offset).toBe(6);
  });

  it('keeps a full maxLen window when focus is at the very last character', () => {
    const text = '0123456789ABCDEF'; // 16 chars
    const result = sliceChapterContent(text, 6, 'F');
    expect(result.text.length).toBe(6);
    expect(result.offset).toBe(10);
    expect(result.text).toBe('ABCDEF');
  });

  it('falls back to a head slice when focus text is not found', () => {
    const text = '0123456789';
    const result = sliceChapterContent(text, 4, 'not-here');
    expect(result.text).toBe('0123');
    expect(result.offset).toBe(0);
    expect(result.truncatedEnd).toBe(true);
  });
});
