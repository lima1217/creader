import type { Book, ChatMessage, ReadingProgress } from '../types';
import type { ReadingContextSnapshot } from './readingSource';

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

export type NoteType = 'question' | 'concept' | 'claim' | 'note';

export type ReadingMemoryCandidate = {
  shouldIngest: boolean;
  type: NoteType;
  confidence: number;
  reason: string;
  titleSeed: string;
};

export type ReadingMemoryMarkdown = {
  title: string;
  body: string;
  metadata: Record<string, unknown>;
};

export function buildReadingMemoryIngestInput(params: {
  rootPath: string;
  readingContext: ReadingContextSnapshot;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}): ReadingMemoryIngestInput | null {
  const book = params.readingContext.book;
  if (!book) return null;

  return {
    rootPath: params.rootPath,
    book,
    userMessage: params.userMessage,
    assistantMessage: params.assistantMessage,
    selectedContext: params.userMessage.context || params.readingContext.selection?.text,
    selectedCfiRange: params.userMessage.contextCfi || params.readingContext.selection?.cfiRange,
    currentChapter: params.readingContext.chapterContent,
    progress: params.readingContext.progress || book.progress,
  };
}

function escapeYaml(value: string): string {
  return JSON.stringify(value.replace(/\r\n/g, '\n'));
}

function excerpt(value: string | undefined, limit = 1400): string {
  const trimmed = (value || '').trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit).trim()}...`;
}

/**
 * Map an internal NoteType to an OKF frontmatter `type` value, matching the
 * book-to-okf-wiki convention (Concept / Claim / OpenQuestions / ChapterNote).
 */
export function okfTypeFor(noteType: NoteType): string {
  switch (noteType) {
    case 'question': return 'OpenQuestions';
    case 'concept': return 'Concept';
    case 'claim': return 'Claim';
    default: return 'ChapterNote';
  }
}

function slugSeed(value: string): string {
  // Keep this aligned with the Rust `book_slug` (src-tauri) so that source_refs
  // cross-link to the same book sub-package directory name. Both lowercase,
  // non-alphanumeric to '-', collapse runs, trim, cap at 60 chars.
  return value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'reading-memory';
}

function inferNoteType(userText: string, assistantText: string): NoteType {
  const combined = `${userText}\n${assistantText}`;
  if (/[?？]|为什么|如何|怎么|是否|what|why|how/i.test(userText)) return 'question';
  if (/概念|定义|意思|解释|meaning|concept/i.test(combined)) return 'concept';
  if (/观点|主张|认为|claim|argument/i.test(combined)) return 'claim';
  return 'note';
}

function compactTitleSeed(value: string): string {
  return value
    .replace(/[#*_>`\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32) || 'reading-memory';
}

function firstMeaningfulLine(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/^#+\s*/, '').trim())
    .find(line => line.length >= 6 && !/^[-—*_]+$/.test(line)) || '';
}

function hasExplicitSaveIntent(text: string): boolean {
  return /记住|沉淀|保存这个|保存到|加入\s*Reading Memory|加入阅读记忆|save this|remember this/i.test(text);
}

function isTranslationRequest(text: string): boolean {
  return /翻译|译者注|translate|translation|译文|源文本|目标语言/i.test(text);
}

function isMetaPrompt(text: string): boolean {
  const markers = [
    /你是(?:一位|一个|我的)/,
    /你的任务/,
    /核心原则/,
    /输出格式/,
    /禁止行为/,
    /阶段一/,
    /阶段二/,
    /阶段三/,
    /输入\s*[:：]?/,
    /请直接输出/,
  ];
  return markers.filter(pattern => pattern.test(text)).length >= 3;
}

function isSocraticInteraction(userText: string, assistantText: string): boolean {
  const combined = `${userText}\n${assistantText}`;
  return /苏格拉底|出题|追问|评估回答|模型还原度|推理自洽|边界意识|问题 A|问题 B|问题 C/.test(combined);
}

function isFollowUpOnly(userText: string, assistantText: string): boolean {
  const shortUserReply = userText.length < 80 && !/[?？]|为什么|如何|怎么|是否/.test(userText);
  const assistantIsCoaching = /追问|你说|你提到|我问|问题变成|如果你能回答/.test(assistantText);
  return shortUserReply && assistantIsCoaching;
}

function hasKnowledgeSignal(userText: string, assistantText: string): boolean {
  const combined = `${userText}\n${assistantText}`;
  return /概念|定义|核心命题|关键概念|证据链|论证|主张|观点|模型|框架|机制|原则|claim|argument|concept|model|thesis/i.test(combined);
}

export function classifyReadingMemoryCandidate(input: ReadingMemoryIngestInput): ReadingMemoryCandidate {
  const userText = input.userMessage.content.trim();
  const answer = input.assistantMessage.content.trim();
  const noteType = inferNoteType(userText, answer);
  const explicitSave = hasExplicitSaveIntent(userText);
  const sourceExcerpt = (input.selectedContext || input.userMessage.context || '').trim();

  const reject = (reason: string): ReadingMemoryCandidate => ({
    shouldIngest: false,
    type: noteType,
    confidence: 0,
    reason,
    titleSeed: compactTitleSeed(firstMeaningfulLine(answer) || userText || reason),
  });

  if (!input.rootPath || !input.book || !answer) return reject('missing root, book, or assistant answer');
  if (answer.includes('No AI CLI available') || answer.includes('Generation stopped')) return reject('assistant response is an error or interrupted generation');
  if (!explicitSave && isTranslationRequest(userText)) return reject('translation output is useful during reading but not a stable knowledge note');
  if (!explicitSave && isMetaPrompt(userText)) return reject('user message is a tool prompt rather than reading content');
  if (!explicitSave && isSocraticInteraction(userText, answer)) return reject('socratic coaching interaction is not a durable note by default');
  if (!explicitSave && isFollowUpOnly(userText, answer)) return reject('short conversational follow-up has not formed a durable knowledge object');
  if (!explicitSave && answer.length < 240 && !hasKnowledgeSignal(userText, answer)) return reject('assistant answer is too short and has no knowledge signal');
  if (!explicitSave && !sourceExcerpt && !hasKnowledgeSignal(userText, answer)) return reject('candidate has no source excerpt or reusable knowledge signal');

  const titleSeed = compactTitleSeed(
    firstMeaningfulLine(answer)
      || (sourceExcerpt ? firstMeaningfulLine(sourceExcerpt) : '')
      || userText
  );

  return {
    shouldIngest: true,
    type: noteType,
    confidence: explicitSave ? 0.9 : 0.76,
    reason: explicitSave ? 'user explicitly asked to save this' : 'candidate contains source-grounded reusable reading knowledge',
    titleSeed,
  };
}

export function buildReadingMemoryMarkdown(input: ReadingMemoryIngestInput): ReadingMemoryMarkdown {
  const created = new Date(input.assistantMessage.timestamp).toISOString();
  const candidate = classifyReadingMemoryCandidate(input);
  const noteType = candidate.type;
  const sourceExcerpt = excerpt(input.selectedContext || input.userMessage.context || input.currentChapter, 1800);
  const title = `${input.book.title} - ${candidate.titleSeed}`;
  const dedupeKey = `${noteType}:${input.book.id}:${slugSeed(candidate.titleSeed)}`;
  const progress = input.progress || input.book.progress;
  const sourceCfi = input.selectedCfiRange || input.userMessage.contextCfi || progress.currentCfi || '';

  const metadata = {
    type: okfTypeFor(noteType),
    status: 'inbox',
    created,
    source_app: 'CReader',
    source_refs: [slugSeed(input.book.title)],
    chapter_refs: progress.currentChapter ? [slugSeed(progress.currentChapter)] : [],
    source_book: input.book.title,
    source_author: input.book.author,
    source_chapter: progress.currentChapter || '',
    source_cfi: sourceCfi,
    source_progress: progress.percentage,
    tags: ['creader', noteType],
    trigger: 'ai_answer',
    confidence: candidate.confidence,
    ingestion_reason: candidate.reason,
    dedupe_key: dedupeKey,
  };

  const frontmatter = [
    '---',
    `type: ${okfTypeFor(noteType)}`,
    `title: ${escapeYaml(title)}`,
    'status: inbox',
    `created: ${created}`,
    'source_app: CReader',
    `source_refs: [${escapeYaml(slugSeed(input.book.title))}]`,
    progress.currentChapter ? `chapter_refs: [${escapeYaml(slugSeed(progress.currentChapter))}]` : 'chapter_refs: []',
    `source_book: ${escapeYaml(input.book.title)}`,
    `source_author: ${escapeYaml(input.book.author)}`,
    `source_chapter: ${escapeYaml(progress.currentChapter || '')}`,
    `source_cfi: ${escapeYaml(sourceCfi)}`,
    `source_progress: ${Number(progress.percentage || 0).toFixed(2)}`,
    `tags: [creader, ${noteType}]`,
    'trigger: ai_answer',
    `confidence: ${candidate.confidence.toFixed(2)}`,
    `ingestion_reason: ${escapeYaml(candidate.reason)}`,
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
