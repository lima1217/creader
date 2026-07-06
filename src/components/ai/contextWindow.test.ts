import { describe, expect, it } from 'vitest';
import { buildSmartChapterContext, MAX_CHAPTER_PROMPT_CHARS, sliceChapterContent } from '../../domain/contextWindow';

describe('buildSmartChapterContext', () => {
  it('returns centered chapter excerpt when there is no focus text', () => {
    const chapter = 'a'.repeat(12000);
    const context = buildSmartChapterContext({
      chapterContent: chapter,
      focusTexts: [],
      chapterIndex: 1,
    });

    expect(context).toContain('Chapter excerpt for background.');
    expect(context).toContain('get_chapter_text(index=1, offset=');
    expect(context!.length).toBeLessThan(chapter.length);
  });

  it('keeps a center window around selected text when focus appears in chapter', () => {
    const chapter = `${'a'.repeat(6000)} important selected passage ${'b'.repeat(6000)}`;
    const context = buildSmartChapterContext({
      chapterContent: chapter,
      focusTexts: ['important selected passage'],
      chapterIndex: 3,
    });

    expect(context).toContain('Surrounding chapter context');
    expect(context).toContain('important selected passage');
    expect(context).toContain('get_chapter_text(index=3, offset=');
    expect(context!.length).toBeLessThan(chapter.length);
  });

  it('omits chapter context when focus text is already long', () => {
    expect(buildSmartChapterContext({
      chapterContent: 'chapter text',
      focusTexts: ['x'.repeat(2500)],
    })).toBeUndefined();
  });

  it('keeps short chapters intact without truncation hint', () => {
    const chapter = 'short chapter body';
    expect(buildSmartChapterContext({
      chapterContent: `  ${chapter}  `,
      focusTexts: [],
    })).toBe(`Chapter excerpt for background.\n${chapter}`);
  });

  it('uses the prompt char budget for long chapters with focus', () => {
    const focus = 'needle in haystack';
    const chapter = `${'a'.repeat(12000)}${focus}${'b'.repeat(12000)}`;
    const context = buildSmartChapterContext({
      chapterContent: chapter,
      focusTexts: [focus],
      chapterIndex: 2,
    });

    const body = context!.split('\n')[1];
    expect([...body.replace(/^…|…$/g, '')].length).toBeLessThanOrEqual(MAX_CHAPTER_PROMPT_CHARS);
    expect(context).toContain('get_chapter_text(index=2, offset=');
  });

  it('adds store slice offset to get_chapter_text hint offset', () => {
    const focus = 'needle in haystack';
    const fullChapter = `${'a'.repeat(12000)}${focus}${'b'.repeat(12000)}`;
    const storeSlice = sliceChapterContent(fullChapter, 10000, focus);
    const context = buildSmartChapterContext({
      chapterContent: storeSlice.text,
      focusTexts: [focus],
      chapterIndex: 4,
      chapterContentOffset: storeSlice.offset,
      chapterSliceTruncatedEnd: storeSlice.truncatedEnd,
    });

    expect(storeSlice.offset).toBeGreaterThan(0);
    const match = context?.match(/offset=(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(storeSlice.offset);
  });
});
