import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book, ChatMessage } from '../types';
import { buildReadingMemoryIngestInput } from '../domain/readingMemory';
import { buildReadingContextSnapshot } from '../domain/readingSource';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

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
      chapterContent: 'chapter content that must not become the excerpt',
      chapterTitle: 'Chapter 3',
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
      currentChapter: 'Chapter 3',
      progress: { currentCfi: 'epubcfi(/6/4)', percentage: 55, currentChapter: 'Chapter 3' },
    });
  });

  it('leaves selectedContext empty when there is no selection or quote', () => {
    const userMessage = message('user', '这一章在讲什么？');
    const assistantMessage = message('assistant', '主题是……');
    const readingContext = buildReadingContextSnapshot({
      book,
      progress: { currentCfi: 'epubcfi(/6/4)', percentage: 55, currentChapter: 'Chapter 3' },
      chapterContent: 'a'.repeat(50_000),
      chapterTitle: 'Chapter 3',
    });

    const input = buildReadingMemoryIngestInput({
      rootPath: '/tmp/memory',
      readingContext,
      userMessage,
      assistantMessage,
    });

    expect(input).toMatchObject({
      selectedContext: undefined,
      currentChapter: 'Chapter 3',
    });
    expect(input?.selectedContext || input?.userMessage.context || '').toBe('');
  });
});

describe('ReadingMemory direct ingest request', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('sends an empty selected_excerpt when there is no selection', async () => {
    const { ingestReadingMemoryDirect } = await import('./ReadingMemory');
    const userMessage = message('user', '这一章在讲什么？');
    const assistantMessage = message('assistant', '主题是……');
    const input = buildReadingMemoryIngestInput({
      rootPath: '/tmp/memory',
      readingContext: buildReadingContextSnapshot({
        book,
        progress: { currentCfi: 'epubcfi(/6/4)', percentage: 55, currentChapter: 'Chapter 3' },
        chapterContent: 'whole chapter body dump',
        chapterTitle: 'Chapter 3',
      }),
      userMessage,
      assistantMessage,
    })!;

    invokeMock.mockResolvedValueOnce({ skipped: true, reason: 'not durable' });
    await ingestReadingMemoryDirect(input);

    expect(invokeMock).toHaveBeenCalledWith('review_reading_memory_direct', {
      request: expect.objectContaining({
        source_chapter: 'Chapter 3',
        selected_excerpt: '',
        user_question: '这一章在讲什么？',
      }),
    });
  });
});
