import { describe, expect, it } from 'vitest';
import {
  renderReadingMemoryNoteMarkdown,
  rewriteReadingMemoryPageMarkdown,
  type ReadingMemoryNoteDecision,
  type ReadingMemoryNoteRenderInput,
} from './readingMemoryMarkdown';

const input: ReadingMemoryNoteRenderInput = {
  book_title: 'Book',
  book_author: 'Author',
  source_chapter: 'Chapter 1',
  source_cfi: 'epubcfi(/6/8,/1:0,/1:10)',
  source_progress: 12.5,
  user_question: '解释这个概念',
  selected_excerpt: 'source excerpt',
  assistant_answer: 'assistant answer',
};

const decision: ReadingMemoryNoteDecision = {
  should_ingest: true,
  target_dir: 'concepts',
  title: '机会成本',
  note_type: 'concept',
  summary: null,
  body: '这是一个可复用概念。\n\n- 它要求比较被放弃的选项。',
  links: ['Related'],
  confidence: 0.82,
  reason: '形成可复用概念',
};

describe('readingMemoryMarkdown', () => {
  it('renders a new OKF note through Markdown AST tooling', () => {
    const markdown = renderReadingMemoryNoteMarkdown(input, decision, {
      timestamp: '2026-07-02T00:00:00Z',
    });

    expect(markdown).toContain('---\ntype: Concept');
    expect(markdown).toContain('source_refs:\n  - Book');
    expect(markdown).toContain('chapter_refs:\n  - Chapter 1');
    expect(markdown).toContain('source_cfi: epubcfi(/6/8,/1:0,/1:10)');
    expect(markdown).toContain('tags:\n  - creader\n  - concept');
    expect(markdown).toContain('status: inbox');
    expect(markdown).toContain('# 机会成本');
    expect(markdown).toContain('> source excerpt');
    expect(markdown).toContain('这是一个可复用概念。');
    expect(markdown).toContain('- [[Related]]');
  });

  it('preserves frontmatter and unrelated content when rewriting a section', () => {
    const original = `---
type: Concept
source_refs:
  - Book
status: inbox
---
# 机会成本

## Note

old note

## Links

- [[Book]]
`;

    const rewritten = rewriteReadingMemoryPageMarkdown(original, {
      heading: 'Note',
      body: 'new note with [[Book]] link',
    });

    expect(rewritten).toContain('---\ntype: Concept');
    expect(rewritten).toContain('# 机会成本');
    expect(rewritten).toContain('## Note\n\nnew note with [[Book]] link');
    expect(rewritten).toContain('## Links\n\n- [[Book]]');
    expect(rewritten.match(/## Note/g)).toHaveLength(1);
    expect(rewritten).not.toContain('old note');
  });

  it('appends a missing section without duplicating existing headings', () => {
    const rewritten = rewriteReadingMemoryPageMarkdown('# Page\n\n## Existing\n\nkeep me\n', {
      heading: 'Sources',
      body: '- [[Book]]',
    });

    expect(rewritten).toContain('## Existing\n\nkeep me');
    expect(rewritten).toContain('## Sources\n\n- [[Book]]');
    expect(rewritten.match(/## Sources/g)).toHaveLength(1);
  });

  it('fails safely for unsupported frontmatter shape', () => {
    expect(() =>
      rewriteReadingMemoryPageMarkdown('---\ntype: Concept\n# no closing fence\n', {
        heading: 'Note',
        body: 'new',
      }),
    ).toThrow(/frontmatter/);
  });
});
