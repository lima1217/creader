import { unified } from 'unified';
import remarkFrontmatter from 'remark-frontmatter';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { stringify as stringifyYaml } from 'yaml';

export type ReadingMemoryNoteDecision = {
  should_ingest: boolean;
  target_dir: 'books' | 'concepts' | 'questions' | 'claims' | null;
  title: string | null;
  note_type: 'book' | 'concept' | 'question' | 'claim' | 'note' | string | null;
  summary: string | null;
  body: string | null;
  links: string[] | null;
  confidence: number | null;
  reason: string | null;
};

export type ReadingMemoryNoteRenderInput = {
  book_title: string;
  book_author?: string | null;
  source_chapter?: string | null;
  source_cfi?: string | null;
  source_progress?: number | null;
  user_question: string;
  selected_excerpt?: string | null;
  assistant_answer: string;
};

export type ReadingMemoryNoteRenderOptions = {
  timestamp?: string;
};

export type ReadingMemorySectionRewrite = {
  heading: string;
  body: string;
};

type MarkdownNode = {
  type: string;
  [key: string]: unknown;
};

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkStringify, {
    bullet: '-',
    fences: true,
    listItemIndent: 'one',
    rule: '-',
  });

export function renderReadingMemoryNoteMarkdown(
  input: ReadingMemoryNoteRenderInput,
  decision: ReadingMemoryNoteDecision,
  options: ReadingMemoryNoteRenderOptions = {},
): string {
  const noteType = normalizeNoteType(decision.note_type, decision.target_dir);
  const title = safeWikiTitle(decision.title || input.book_title);
  const body = (decision.body || decision.summary || '').trim();
  const sourceExcerpt = (input.selected_excerpt || '').trim();
  const links = normalizeLinks(decision.links, input.book_title);
  const timestamp = options.timestamp || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const frontmatter = stringifyYaml({
    type: okfTypeFor(noteType),
    title,
    source_app: 'CReader',
    source_refs: [safeWikiTitle(input.book_title)],
    chapter_refs: input.source_chapter ? [input.source_chapter] : [],
    source_book: input.book_title,
    source_author: input.book_author || '',
    source_chapter: input.source_chapter || '',
    source_cfi: input.source_cfi || '',
    source_progress: Number(input.source_progress || 0),
    target_dir: decision.target_dir || '',
    tags: ['creader', noteType],
    status: 'inbox',
    timestamp,
    confidence: Number(decision.confidence || 0),
    ingestion_reason: decision.reason || '',
  }).trim();

  const root = {
    type: 'root',
    children: [
      { type: 'yaml', value: frontmatter },
      heading(1, title),
      heading(2, 'Source'),
      sourceExcerpt
        ? blockquote(sourceExcerpt)
        : paragraph('_No selected excerpt was captured._'),
      heading(2, 'Question'),
      paragraph(input.user_question.trim()),
      heading(2, 'Note'),
      ...parseMarkdownFragment(body),
      heading(2, 'Links'),
      list(links.map((link) => `[[${link}]]`)),
    ],
  };

  return finalizeMarkdown(processor.stringify(root as never));
}

export function rewriteReadingMemoryPageMarkdown(
  markdown: string,
  rewrite: ReadingMemorySectionRewrite,
): string {
  assertSupportedMarkdown(markdown);
  const tree = processor.parse(markdown) as { type: 'root'; children: MarkdownNode[] };
  const nextSection = [
    heading(2, rewrite.heading),
    ...parseMarkdownFragment(rewrite.body),
  ] as MarkdownNode[];

  const existingIndex = tree.children.findIndex((node) => isHeading(node, 2, rewrite.heading));
  if (existingIndex === -1) {
    tree.children.push(...nextSection);
    return finalizeMarkdown(processor.stringify(tree as never));
  }

  let endIndex = existingIndex + 1;
  while (endIndex < tree.children.length) {
    const node = tree.children[endIndex];
    if (node.type === 'heading' && Number(node.depth) <= 2) break;
    endIndex += 1;
  }
  tree.children.splice(existingIndex, endIndex - existingIndex, ...nextSection);
  return finalizeMarkdown(processor.stringify(tree as never));
}

function assertSupportedMarkdown(markdown: string): void {
  const trimmedStart = markdown.trimStart();
  if (!trimmedStart.startsWith('---')) return;

  const firstFenceEnd = trimmedStart.indexOf('\n---', 3);
  if (firstFenceEnd === -1) {
    throw new Error('Invalid Markdown frontmatter: missing closing fence');
  }
}

function parseMarkdownFragment(markdown: string): MarkdownNode[] {
  const trimmed = markdown.trim();
  if (!trimmed) return [paragraph('_No note body was produced._')];
  const tree = processor.parse(trimmed) as { type: 'root'; children: MarkdownNode[] };
  return tree.children;
}

function heading(depth: number, text: string): MarkdownNode {
  return {
    type: 'heading',
    depth,
    children: [{ type: 'text', value: text }],
  };
}

function paragraph(text: string): MarkdownNode {
  return {
    type: 'paragraph',
    children: [{ type: 'text', value: text }],
  };
}

function blockquote(text: string): MarkdownNode {
  return {
    type: 'blockquote',
    children: text.split(/\r?\n/).map((line) => paragraph(line)),
  };
}

function list(items: string[]): MarkdownNode {
  return {
    type: 'list',
    ordered: false,
    spread: false,
    children: items.map((item) => ({
      type: 'listItem',
      spread: false,
      children: [paragraph(item)],
    })),
  };
}

function isHeading(node: MarkdownNode, depth: number, text: string): boolean {
  if (node.type !== 'heading' || Number(node.depth) !== depth) return false;
  return textFromChildren(node.children).trim() === text.trim();
}

function textFromChildren(children: unknown): string {
  if (!Array.isArray(children)) return '';
  return children
    .map((child) => {
      if (!child || typeof child !== 'object') return '';
      const node = child as MarkdownNode;
      if (typeof node.value === 'string') return node.value;
      return textFromChildren(node.children);
    })
    .join('');
}

function normalizeLinks(links: string[] | null | undefined, fallbackBookTitle: string): string[] {
  const normalized = (links || [])
    .map((link) => safeWikiTitle(link))
    .filter(Boolean);
  return normalized.length > 0 ? normalized : [safeWikiTitle(fallbackBookTitle)];
}

function normalizeNoteType(
  noteType: ReadingMemoryNoteDecision['note_type'],
  targetDir: ReadingMemoryNoteDecision['target_dir'],
): string {
  const value = String(noteType || '').trim().toLowerCase();
  if (['question', 'concept', 'claim', 'book'].includes(value)) return value;
  if (targetDir === 'concepts') return 'concept';
  if (targetDir === 'questions') return 'question';
  if (targetDir === 'claims') return 'claim';
  if (targetDir === 'books') return 'book';
  return 'note';
}

function okfTypeFor(noteType: string): string {
  if (noteType === 'question') return 'OpenQuestions';
  if (noteType === 'concept') return 'Concept';
  if (noteType === 'claim') return 'Claim';
  return 'ChapterNote';
}

function safeWikiTitle(input: string): string {
  const cleaned = input
    .replace(/[\\/:*?"<>|.]/g, ' ')
    .replace(/[\n\r\t]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .trim();
  return Array.from(cleaned || 'reading-memory').slice(0, 80).join('');
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function finalizeMarkdown(value: string): string {
  return ensureTrailingNewline(value.replace(/\\\[\\\[/g, '[[').replace(/\\\]\\\]/g, ']]'));
}
