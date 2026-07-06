import { describe, expect, it } from 'vitest';
import type { Book, ChatMessage, Settings } from '../types';
import { buildChatRequest, buildContextFromReadingSnapshot, createUserChatMessage } from './aiRequest';
import { buildReadingContextSnapshot } from './readingSource';

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

const settings: Settings = {
  theme: 'light',
  fontSize: 16,
  fontFamily: 'Georgia',
  lineHeight: 1.6,
  readingMemoryAutoIngest: true,
  aiTextSize: 14,
  aiContextWindow: 5,
  aiToolRounds: 8,
  aiAutoSummarize: true,
  aiThinkingEnabled: false,
};

function msg(index: number): ChatMessage {
  return {
    id: `msg-${index}`,
    role: index % 2 === 0 ? 'assistant' : 'user',
    content: `message ${index}`,
    timestamp: index,
  };
}

describe('AI request domain', () => {
  it('combines selected and accumulated text into one context block', () => {
    const result = buildContextFromReadingSnapshot(buildReadingContextSnapshot({
      book,
      selectedText: 'selected',
      accumulatedTexts: ['first', 'second'],
    }));

    expect(result.focusTexts).toEqual(['selected', 'first', 'second']);
    expect(result.combinedContext).toBe('selected\n\n---\n\nfirst\n\n---\n\nsecond');
  });

  it('creates a trimmed user message with optional CFI source', () => {
    const message = createUserChatMessage({
      id: '1',
      content: '  explain this  ',
      timestamp: 123,
      context: 'selected text',
      contextCfi: 'epubcfi(/6/2)',
    });

    expect(message).toMatchObject({
      id: '1',
      role: 'user',
      content: 'explain this',
      timestamp: 123,
      context: 'selected text',
      contextCfi: 'epubcfi(/6/2)',
    });
  });

  it('builds chat requests with trimmed history and nearby chapter context', () => {
    const focus = 'selected passage with enough length';
    const readingContext = buildReadingContextSnapshot({
      book,
      selectedText: focus,
      chapterContent: `Intro. Before details. ${focus} After details. End.`,
      chapterIndex: 2,
      chapterTitle: 'Chapter 2',
    });
    const request = buildChatRequest({
      message: 'What does this mean?',
      readingContext,
      conversationSummary: 'Older discussion summary',
      chatMessages: Array.from({ length: 7 }, (_, index) => msg(index + 1)),
      settings,
    });

    expect(request.message).toBe('What does this mean?');
    expect(request.context).toBe(focus);
    expect(request.book_title).toBe('Book');
    expect(request.source_chapter).toBe('Chapter 2');
    expect(request.source_chapter_index).toBe(2);
    expect(request.max_tool_rounds).toBe(8);
    expect(request.conversation_summary).toBe('Older discussion summary');
    expect(request.history).toHaveLength(5);
    expect(request.history?.[0]).toEqual({ role: 'user', content: 'message 3' });
    // The active provider/model is resolved by the backend; the request itself
    // no longer carries provider/model fields.
    expect((request as unknown as Record<string, unknown>).provider).toBeUndefined();
    expect((request as unknown as Record<string, unknown>).model).toBeUndefined();
    expect(request.chapter_content).toContain('Surrounding chapter context near the selected text');
  });

  it('can build chat requests from a reading context snapshot', () => {
    const focus = 'selected passage with enough length';
    const readingContext = buildReadingContextSnapshot({
      book,
      selectedText: focus,
      selectedCfiRange: 'epubcfi(/6/2,/1:0,/1:10)',
      accumulatedTexts: ['saved excerpt'],
      chapterContent: `Intro. ${focus} Outro.`,
    });

    expect(buildContextFromReadingSnapshot(readingContext).combinedContext).toBe(`${focus}\n\n---\n\nsaved excerpt`);

    const request = buildChatRequest({
      message: 'Explain',
      readingContext,
      conversationSummary: undefined,
      chatMessages: [],
      settings,
    });

    expect(request.context).toBe(`${focus}\n\n---\n\nsaved excerpt`);
    expect(request.book_title).toBe('Book');
    expect(request.chapter_content).toContain('Surrounding chapter context near the selected text');
  });

  it('falls back to progress CFI when there is no selection', () => {
    const readingContext = buildReadingContextSnapshot({
      book,
      progress: { currentCfi: 'epubcfi(/6/20)', percentage: 55 },
    });
    const request = buildChatRequest({
      message: 'Explain',
      readingContext,
      chatMessages: [],
      settings,
    });

    expect(request.source_cfi).toBe('epubcfi(/6/20)');
  });

  it('adds frozen source labels to user history messages', () => {
    const readingContext = buildReadingContextSnapshot({
      book,
      chapterIndex: 7,
      chapterTitle: '第七章',
      progress: { currentCfi: 'epubcfi(/6/20)', percentage: 55, currentChapter: '第七章' },
    });
    const request = buildChatRequest({
      message: '继续',
      readingContext,
      chatMessages: [{
        id: '1',
        role: 'user',
        content: '这里什么意思？',
        timestamp: 1,
        context: 'selected excerpt from chapter seven',
        sourceChapter: '第七章',
        sourceChapterIndex: 7,
        sourceProgress: 55,
      }],
      settings,
    });

    expect(request.history?.[0].content).toContain('[来源: index=7「第七章」·55.0%]');
    expect(request.history?.[0].content).toContain('[选区: selected excerpt from chapter seven]');
    expect(request.history?.[0].content).toContain('这里什么意思？');
  });
});
