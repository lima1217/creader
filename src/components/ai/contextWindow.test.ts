import { describe, expect, it } from 'vitest';
import { buildSmartChapterContext } from '../../domain/contextWindow';

describe('buildSmartChapterContext', () => {
  it('returns full chapter content when there is no focus text', () => {
    expect(buildSmartChapterContext({
      chapterContent: '  first paragraph\n\nsecond paragraph  ',
      focusTexts: [],
    })).toBe('first paragraph\n\nsecond paragraph');
  });

  it('keeps only nearby chapter context when selected text appears in chapter', () => {
    const chapter = `${'a'.repeat(2000)} important selected passage ${'b'.repeat(2000)}`;
    const context = buildSmartChapterContext({
      chapterContent: chapter,
      focusTexts: ['important selected passage'],
    });

    expect(context).toContain('Surrounding chapter context');
    expect(context).toContain('Before:');
    expect(context).toContain('After:');
    expect(context).not.toContain('important selected passage');
    expect(context!.length).toBeLessThan(chapter.length);
  });

  it('omits chapter context when focus text is already long', () => {
    expect(buildSmartChapterContext({
      chapterContent: 'chapter text',
      focusTexts: ['x'.repeat(2500)],
    })).toBeUndefined();
  });
});
