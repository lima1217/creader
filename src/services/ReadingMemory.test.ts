import { describe, expect, it } from 'vitest';
import type { Book, ChatMessage } from '../types';
import { buildReadingMemoryMarkdown } from './ReadingMemory';

describe('ReadingMemory markdown', () => {
  it('prefers selected CFI over current reading progress CFI', () => {
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
    const userMessage: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: '解释这段',
      context: 'selected text',
      contextCfi: 'epubcfi(/6/2[chapter]!/4/8,/1:0,/1:10)',
      timestamp: 10,
    };
    const assistantMessage: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '这是一段足够长的回答，用来触发 Reading Memory 的普通正文生成路径。',
      timestamp: 11,
    };

    const note = buildReadingMemoryMarkdown({
      rootPath: '/tmp/memory',
      book,
      userMessage,
      assistantMessage,
      selectedContext: userMessage.context,
      selectedCfiRange: userMessage.contextCfi,
      progress: book.progress,
    });

    expect(note.metadata.source_cfi).toBe(userMessage.contextCfi);
    expect(note.body).toContain(`source_cfi: "${userMessage.contextCfi}"`);
  });
});
