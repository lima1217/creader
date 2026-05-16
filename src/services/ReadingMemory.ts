import { invoke } from '@tauri-apps/api/core';
import type { Book, ChatMessage, ReadingProgress } from '../types';

export type ReadingMemoryIngestInput = {
  rootPath: string;
  book: Book;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  selectedContext?: string;
  selectedCfiRange?: string;
  currentChapter?: string;
  progress?: ReadingProgress;
};

type IngestResult = {
  note_path: string;
  log_path: string;
};

function escapeYaml(value: string): string {
  return JSON.stringify(value.replace(/\r\n/g, '\n'));
}

function excerpt(value: string | undefined, limit = 1400): string {
  const trimmed = (value || '').trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit).trim()}...`;
}

function slugSeed(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'reading-memory';
}

function inferNoteType(userText: string, assistantText: string): 'question' | 'concept' | 'claim' | 'note' {
  const combined = `${userText}\n${assistantText}`;
  if (/[?？]|为什么|如何|怎么|是否|what|why|how/i.test(userText)) return 'question';
  if (/概念|定义|意思|解释|meaning|concept/i.test(combined)) return 'concept';
  if (/观点|主张|认为|claim|argument/i.test(combined)) return 'claim';
  return 'note';
}

function shouldIngest(input: ReadingMemoryIngestInput): boolean {
  const answer = input.assistantMessage.content.trim();
  if (!input.rootPath || !input.book || !answer) return false;
  if (answer.includes('No AI CLI available') || answer.includes('Generation stopped')) return false;
  if (answer.length < 160 && !input.selectedContext) return false;
  return true;
}

export function buildReadingMemoryMarkdown(input: ReadingMemoryIngestInput): { title: string; body: string; metadata: Record<string, unknown> } {
  const created = new Date(input.assistantMessage.timestamp).toISOString();
  const noteType = inferNoteType(input.userMessage.content, input.assistantMessage.content);
  const sourceExcerpt = excerpt(input.selectedContext || input.userMessage.context || input.currentChapter, 1800);
  const title = `${input.book.title} - ${slugSeed(input.userMessage.content)}`;
  const dedupeKey = `${noteType}:${input.book.id}:${slugSeed(input.userMessage.content)}`;
  const progress = input.progress || input.book.progress;
  const sourceCfi = input.selectedCfiRange || input.userMessage.contextCfi || progress.currentCfi || '';

  const metadata = {
    type: noteType,
    status: 'inbox',
    created,
    source_app: 'CReader',
    source_book: input.book.title,
    source_author: input.book.author,
    source_chapter: progress.currentChapter || '',
    source_cfi: sourceCfi,
    source_progress: progress.percentage,
    trigger: 'ai_answer',
    confidence: 0.72,
    dedupe_key: dedupeKey,
  };

  const frontmatter = [
    '---',
    `type: ${noteType}`,
    'status: inbox',
    `created: ${created}`,
    'source_app: CReader',
    `source_book: ${escapeYaml(input.book.title)}`,
    `source_author: ${escapeYaml(input.book.author)}`,
    `source_chapter: ${escapeYaml(progress.currentChapter || '')}`,
    `source_cfi: ${escapeYaml(sourceCfi)}`,
    `source_progress: ${Number(progress.percentage || 0).toFixed(2)}`,
    'trigger: ai_answer',
    'confidence: 0.72',
    `dedupe_key: ${escapeYaml(dedupeKey)}`,
    '---',
  ].join('\n');

  const body = `${frontmatter}

# ${title}

## Question
${input.userMessage.content.trim()}

## Source
${sourceExcerpt ? `> ${sourceExcerpt.replace(/\n/g, '\n> ')}` : '_No selected excerpt was captured._'}

## Note
${input.assistantMessage.content.trim()}

## Links
- [[${input.book.title}]]

## Lint Hints
- Promote this note if it introduces a reusable concept, question, or claim.
- Merge with notes that share the same \`dedupe_key\`.
`;

  return { title, body, metadata };
}

export async function ensureReadingMemoryRepository(rootPath: string): Promise<string> {
  return await invoke<string>('ensure_reading_memory_repository', { rootPath });
}

export async function ingestReadingMemoryNote(input: ReadingMemoryIngestInput): Promise<IngestResult | null> {
  if (!shouldIngest(input)) return null;
  const note = buildReadingMemoryMarkdown(input);
  return await invoke<IngestResult>('ingest_reading_memory_note', {
    request: {
      root_path: input.rootPath,
      title: note.title,
      body: note.body,
      metadata: note.metadata,
    },
  });
}
