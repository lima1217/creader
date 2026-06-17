import { describe, expect, it } from 'vitest';
import type { Book, ChatMessage } from '../types';
import { buildReadingMemoryIngestInput } from '../domain/readingMemory';
import { buildReadingContextSnapshot } from '../domain/readingSource';

const book: Book = {
  id: 'book-1',
  title: 'Book',
  author: 'Author',
  filePath: '/tmp/book.epub',
  addedAt: 1,
  progress: {
    currentCfi: 'epubcfi(/6/2[chapter]!/4/2)',
    percentage: 40,
  },
};

function message(role: 'user' | 'assistant', content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `${role}-${content.slice(0, 8)}`,
    role,
    content,
    timestamp: role === 'user' ? 10 : 11,
    ...extra,
  };
}

describe('ReadingMemory input', () => {
  it('builds ingest input from a frozen reading context snapshot', () => {
    const userMessage = message('user', '解释这段', {
      context: 'selected from message',
      contextCfi: 'epubcfi(/6/4,/1:0,/1:10)',
    });
    const assistantMessage = message('assistant', '这是一个可复用概念。');
    const readingContext = buildReadingContextSnapshot({
      book,
      progress: { currentCfi: 'epubcfi(/6/4)', percentage: 55, currentChapter: 'Chapter 3' },
      selectedText: 'selected from reader',
      selectedCfiRange: 'epubcfi(/6/4,/1:0,/1:20)',
      chapterContent: 'chapter content',
    });

    expect(buildReadingMemoryIngestInput({
      rootPath: '/tmp/memory',
      readingContext,
      userMessage,
      assistantMessage,
    })).toMatchObject({
      rootPath: '/tmp/memory',
      book: {
        ...book,
        progress: { currentCfi: 'epubcfi(/6/4)', percentage: 55, currentChapter: 'Chapter 3' },
      },
      userMessage,
      assistantMessage,
      selectedContext: 'selected from message',
      selectedCfiRange: 'epubcfi(/6/4,/1:0,/1:10)',
      currentChapter: 'chapter content',
      progress: { currentCfi: 'epubcfi(/6/4)', percentage: 55, currentChapter: 'Chapter 3' },
    });
  });
});
