import { describe, expect, it } from 'vitest';
import type { Book, ChatMessage, Settings } from '../types';
import { buildAIModelSettings, buildChatRequest, combineFocusTexts, createUserChatMessage } from './aiRequest';

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
  allowEpubScripts: true,
  allowAIDangerousPermissions: false,
  readingMemoryAutoIngest: true,
  aiProvider: 'claude',
  aiModel: 'opus-4.7',
  hermesModel: 'glm-5.1',
  aiTextSize: 14,
  aiContextWindow: 5,
  aiAutoSummarize: true,
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
    const result = combineFocusTexts('selected', ['first', 'second']);

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

  it('selects provider-specific model overrides', () => {
    expect(buildAIModelSettings(settings)).toBe('opus-4.7');
    expect(buildAIModelSettings({ ...settings, aiProvider: 'hermes' })).toBe('glm-5.1');
    expect(buildAIModelSettings({ ...settings, aiProvider: 'codex' })).toBeUndefined();
  });

  it('builds chat requests with trimmed history and nearby chapter context', () => {
    const focus = 'selected passage with enough length';
    const request = buildChatRequest({
      message: 'What does this mean?',
      combinedContext: focus,
      currentBook: book,
      currentChapterContent: `Intro. Before details. ${focus} After details. End.`,
      focusTexts: [focus],
      conversationSummary: 'Older discussion summary',
      chatMessages: Array.from({ length: 7 }, (_, index) => msg(index + 1)),
      settings,
    });

    expect(request.message).toBe('What does this mean?');
    expect(request.context).toBe(focus);
    expect(request.book_title).toBe('Book');
    expect(request.conversation_summary).toBe('Older discussion summary');
    expect(request.history).toHaveLength(5);
    expect(request.history?.[0]).toEqual({ role: 'user', content: 'message 3' });
    expect(request.provider).toBe('claude');
    expect(request.model).toBe('opus-4.7');
    expect(request.chapter_content).toContain('Surrounding chapter context near the selected text');
  });
});
