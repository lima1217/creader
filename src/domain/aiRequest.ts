import type { ChatMessage, Settings } from '../types';
import { buildSmartChapterContext } from './contextWindow';
import type { ReadingContextSnapshot } from './readingSource';
import { getReadingFocusTexts } from './readingSource';

export interface ChatRequest {
  message: string;
  context?: string;
  book_title?: string;
  book_author?: string;
  book_file_path?: string;
  source_chapter?: string;
  source_chapter_index?: number;
  source_cfi?: string;
  source_progress?: number;
  reading_memory_path?: string;
  chapter_content?: string;
  conversation_summary?: string;
  history?: { role: string; content: string }[];
  thinking_enabled?: boolean;
  max_tool_rounds?: number;
}

function truncateForHistoryLabel(text: string, limit: number): string {
  const trimmed = text.trim();
  if ([...trimmed].length <= limit) return trimmed;
  return `${[...trimmed].slice(0, limit).join('')}…`;
}

function formatHistoryMessage(message: ChatMessage): { role: string; content: string } {
  if (message.role !== 'user') {
    return { role: message.role, content: message.content };
  }

  const parts: string[] = [];
  if (message.sourceChapterIndex !== undefined || message.sourceChapter) {
    const indexPart = message.sourceChapterIndex !== undefined
      ? `index=${message.sourceChapterIndex}`
      : '';
    const titlePart = message.sourceChapter ? `「${message.sourceChapter}」` : '';
    const label = [indexPart, titlePart].filter(Boolean).join('');
    const progressPart = message.sourceProgress !== undefined
      ? `·${message.sourceProgress.toFixed(1)}%`
      : '';
    if (label || progressPart) {
      parts.push(`[来源: ${label}${progressPart}]`);
    }
  }
  if (message.context) {
    parts.push(`[选区: ${truncateForHistoryLabel(message.context, 80)}]`);
  }
  parts.push(message.content);
  return { role: message.role, content: parts.join('\n') };
}

export function buildContextFromReadingSnapshot(snapshot: ReadingContextSnapshot): {
  focusTexts: string[];
  combinedContext?: string;
} {
  const focusTexts = getReadingFocusTexts(snapshot);
  return {
    focusTexts,
    combinedContext: focusTexts.length > 0 ? focusTexts.join('\n\n---\n\n') : undefined,
  };
}

export function createUserChatMessage(params: {
  id: string;
  content: string;
  timestamp: number;
  context?: string;
  contextCfi?: string;
  sourceChapter?: string;
  sourceChapterIndex?: number;
  sourceProgress?: number;
}): ChatMessage {
  return {
    id: params.id,
    role: 'user',
    content: params.content.trim(),
    timestamp: params.timestamp,
    context: params.context,
    contextCfi: params.contextCfi || undefined,
    sourceChapter: params.sourceChapter,
    sourceChapterIndex: params.sourceChapterIndex,
    sourceProgress: params.sourceProgress,
  };
}

export function buildChatRequest(params: {
  message: string;
  readingContext: ReadingContextSnapshot;
  conversationSummary?: string;
  chatMessages: ChatMessage[];
  settings: Pick<Settings, 'aiContextWindow' | 'aiToolRounds' | 'readingMemoryPath' | 'aiThinkingEnabled'>;
}): ChatRequest {
  const derivedContext = buildContextFromReadingSnapshot(params.readingContext);
  const chapterTitle = params.readingContext.chapterTitle
    || params.readingContext.progress?.currentChapter;

  return {
    message: params.message,
    context: derivedContext.combinedContext,
    book_title: params.readingContext.book?.title,
    book_author: params.readingContext.book?.author,
    book_file_path: params.readingContext.book?.filePath,
    source_chapter: chapterTitle,
    source_chapter_index: params.readingContext.chapterIndex,
    source_cfi: params.readingContext.selection?.cfiRange ?? params.readingContext.progress?.currentCfi,
    source_progress: params.readingContext.progress?.percentage,
    reading_memory_path: params.settings.readingMemoryPath,
    chapter_content: buildSmartChapterContext({
      chapterContent: params.readingContext.chapterContent,
      focusTexts: derivedContext.focusTexts,
      chapterIndex: params.readingContext.chapterIndex,
      chapterContentOffset: params.readingContext.chapterContentOffset,
      chapterSliceTruncatedEnd: params.readingContext.chapterSliceTruncatedEnd,
    }),
    conversation_summary: params.conversationSummary,
    history: params.chatMessages
      .slice(-params.settings.aiContextWindow)
      .map(formatHistoryMessage),
    thinking_enabled: params.settings.aiThinkingEnabled ? true : undefined,
    max_tool_rounds: params.settings.aiToolRounds,
  };
}
