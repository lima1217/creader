import { describe, expect, it } from 'vitest';
import type { Book } from '../types';
import { buildReadingContextSnapshot, getReadingFocusTexts } from './readingSource';

function createBook(): Book {
  return {
    id: 'book-1',
    title: 'Book',
    author: 'Author',
    filePath: '/tmp/book.epub',
    addedAt: 1,
    progress: {
      currentCfi: 'epubcfi(/6/2)',
      percentage: 10,
    },
  };
}

describe('reading source domain', () => {
  it('builds an EPUB reading context snapshot from reader state', () => {
    const book = createBook();
    const progress = { currentCfi: 'epubcfi(/6/4)', percentage: 35, currentChapter: 'Chapter 2' };
    const snapshot = buildReadingContextSnapshot({
      book,
      progress,
      selectedText: ' selected passage ',
      selectedCfiRange: ' epubcfi(/6/4,/1:0,/1:8) ',
      accumulatedTexts: [' first saved excerpt ', '', 'second saved excerpt'],
      chapterContent: 'chapter text',
    });

    expect(snapshot).toEqual({
      kind: 'epub',
      book: { ...book, progress },
      progress,
      selection: {
        text: 'selected passage',
        cfiRange: 'epubcfi(/6/4,/1:0,/1:8)',
      },
      accumulatedTexts: ['first saved excerpt', 'second saved excerpt'],
      chapterContent: 'chapter text',
    });
  });

  it('falls back to book progress and omits empty selections', () => {
    const book = createBook();
    const snapshot = buildReadingContextSnapshot({
      book,
      selectedText: '   ',
      accumulatedTexts: ['  note  '],
    });

    expect(snapshot.progress).toStrictEqual(book.progress);
    expect(snapshot.progress).not.toBe(book.progress);
    expect(snapshot.selection).toBeUndefined();
    expect(getReadingFocusTexts(snapshot)).toEqual(['note']);
  });

  it('freezes book and progress values instead of retaining mutable references', () => {
    const book = createBook();
    const snapshot = buildReadingContextSnapshot({ book });

    book.progress.percentage = 80;

    expect(snapshot.book).not.toBe(book);
    expect(snapshot.progress).not.toBe(book.progress);
    expect(snapshot.progress?.percentage).toBe(10);
    expect(snapshot.book?.progress.percentage).toBe(10);
  });
});
