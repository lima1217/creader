import type { ChatMessage, Settings } from '../types';
import { buildSmartChapterContext } from './contextWindow';
import type { ReadingContextSnapshot } from './readingSource';
import { getReadingFocusTexts } from './readingSource';

export interface ChatRequest {
  message: string;
  context?: string;
  book_title?: string;
  chapter_content?: string;
  conversation_summary?: string;
  history?: { role: string; content: string }[];
  provider?: string;
  model?: string;
}

export function buildAIModelSettings(settings: Pick<Settings, 'aiProvider' | 'aiModel' | 'hermesModel'>): string | undefined {
  if (settings.aiProvider === 'claude') return settings.aiModel;
  if (settings.aiProvider === 'hermes') return settings.hermesModel;
  return undefined;
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
}): ChatMessage {
  return {
    id: params.id,
    role: 'user',
    content: params.content.trim(),
    timestamp: params.timestamp,
    context: params.context,
    contextCfi: params.contextCfi || undefined,
  };
}

export function buildChatRequest(params: {
  message: string;
  readingContext: ReadingContextSnapshot;
  conversationSummary?: string;
  chatMessages: ChatMessage[];
  settings: Pick<Settings, 'aiProvider' | 'aiModel' | 'hermesModel' | 'aiContextWindow'>;
}): ChatRequest {
  const derivedContext = buildContextFromReadingSnapshot(params.readingContext);

  return {
    message: params.message,
    context: derivedContext.combinedContext,
    book_title: params.readingContext.book?.title,
    chapter_content: buildSmartChapterContext({
      chapterContent: params.readingContext.chapterContent,
      focusTexts: derivedContext.focusTexts,
    }),
    conversation_summary: params.conversationSummary,
    history: params.chatMessages.slice(-params.settings.aiContextWindow).map(message => ({
      role: message.role,
      content: message.content,
    })),
    provider: params.settings.aiProvider,
    model: buildAIModelSettings(params.settings),
  };
}
