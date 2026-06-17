import { describe, expect, it } from 'vitest';
import type { Book, ChatMessage } from '../types';
import { buildReadingMemoryIngestInput, buildReadingMemoryMarkdown, classifyReadingMemoryCandidate, okfTypeFor } from '../domain/readingMemory';
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

function input(userContent: string, assistantContent: string, extraUser: Partial<ChatMessage> = {}) {
  const userMessage = message('user', userContent, extraUser);
  return {
    rootPath: '/tmp/memory',
    book,
    userMessage,
    assistantMessage: message('assistant', assistantContent),
    selectedContext: userMessage.context,
    selectedCfiRange: userMessage.contextCfi,
    progress: book.progress,
  };
}

describe('ReadingMemory markdown', () => {
  it('prefers selected CFI over current reading progress CFI', () => {
    const note = buildReadingMemoryMarkdown({
      ...input(
        '解释这段',
        '## 机会成本\n机会成本是一个可复用的决策概念，它强调每一次选择都隐含放弃的替代路径。',
        {
          context: 'selected text',
          contextCfi: 'epubcfi(/6/2[chapter]!/4/8,/1:0,/1:10)',
        }
      ),
    });

    expect(note.metadata.source_cfi).toBe('epubcfi(/6/2[chapter]!/4/8,/1:0,/1:10)');
    expect(note.body).toContain('source_cfi: "epubcfi(/6/2[chapter]!/4/8,/1:0,/1:10)"');
  });

  it('emits OKF frontmatter types and source refs', () => {
    expect(okfTypeFor('question')).toBe('OpenQuestions');
    expect(okfTypeFor('concept')).toBe('Concept');
    expect(okfTypeFor('claim')).toBe('Claim');
    expect(okfTypeFor('note')).toBe('ChapterNote');

    const note = buildReadingMemoryMarkdown({
      ...input(
        '解释这段',
        '## 机会成本\n机会成本是一个可复用的决策概念，它强调每一次选择都隐含放弃的替代路径。',
        { context: 'selected source passage' }
      ),
    });

    // concept -> OKF Concept type, with source_refs / chapter_refs for tracing.
    expect(note.body).toContain('type: Concept');
    expect(note.body).toContain('source_refs:');
    expect(note.body).toContain('tags: [creader, concept]');
    expect(Array.isArray(note.metadata.source_refs)).toBe(true);
    expect(note.metadata.source_refs).toHaveLength(1);
  });

  it('rejects translation requests by default', () => {
    const candidate = classifyReadingMemoryCandidate(input(
      '请将以下选取的内容翻译为简体中文，并保留原文语域。',
      '这是一段准确、自然、流畅的翻译结果。',
      { context: 'source text' }
    ));

    expect(candidate.shouldIngest).toBe(false);
    expect(candidate.reason).toContain('translation');
  });

  it('rejects meta prompts and socratic coaching interactions', () => {
    const candidate = classifyReadingMemoryCandidate(input(
      '你是一位苏格拉底式阅读教练。你的任务是检验用户是否内化作者模型。核心原则：不要给答案。输出格式如下。禁止行为如下。',
      '### 问题 A\n如果作者的前提不成立，结论会如何变化？\n### 问题 B\n用这个模型分析新场景。',
      { context: 'chapter text' }
    ));

    expect(candidate.shouldIngest).toBe(false);
    expect(candidate.reason).toMatch(/prompt|socratic/i);
  });

  it('rejects short conversational follow-up coaching', () => {
    const candidate = classifyReadingMemoryCandidate(input(
      '我觉得是两个层面的东西。知识是知识，直觉也容易被错误引导',
      '## 评估\n你做了一个重要区分。\n\n## 追问\n那么我问：默认直觉从哪里来？',
      { context: 'chapter text' }
    ));

    expect(candidate.shouldIngest).toBe(false);
    expect(candidate.reason).toContain('socratic');
  });

  it('allows source-grounded reusable concept notes', () => {
    const candidate = classifyReadingMemoryCandidate(input(
      '解释这段',
      '## 新科学的传播模型\n这个模型的核心命题是：当一个智力结构无法拆成渐进小论文时，它需要以完整框架的形式呈现。这个观点可以迁移到其他原创思想体系。',
      { context: 'selected source passage' }
    ));

    expect(candidate.shouldIngest).toBe(true);
    expect(candidate.type).toBe('concept');
    expect(candidate.confidence).toBeGreaterThan(0.7);
  });

  it('allows explicit save intent even for a short note', () => {
    const candidate = classifyReadingMemoryCandidate(input(
      '记住这个：直觉也是历史训练出来的',
      '已保存为一个可后续展开的阅读判断。',
      { context: 'selected source passage' }
    ));

    expect(candidate.shouldIngest).toBe(true);
    expect(candidate.confidence).toBe(0.9);
  });

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
