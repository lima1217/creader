import { Channel, invoke } from '@tauri-apps/api/core';
import { buildReadingMemoryIngestInput, ingestReadingMemoryDirect } from '../../services/ReadingMemory';
import type { Book, ChatMessage, ConversationMemory, Settings } from '../../types';
import { buildChatRequest, buildContextFromReadingSnapshot, createUserChatMessage } from '../../domain/aiRequest';
import type { ChatRequest } from '../../domain/aiRequest';
import { buildReadingContextSnapshot } from '../../domain/readingSource';
import type { ReadingContextSnapshot } from '../../domain/readingSource';
import type { BookProgressById } from '../../stores/app/initialState';
import { createLogger } from '../../utils/logger';
import { perfMark, perfMeasure } from '../../utils/perf';
import { getMessagesToSummarize } from './conversationMemory';
import { createOnceCommitter } from './streamCommit';

const logger = createLogger('AIConversationSession');

type SummarizeConversationRequest = {
  existing_summary?: string;
  messages: { role: string; content: string }[];
  book_title?: string;
};

export type StreamEvent =
  | { event: 'started'; data: { provider: string } }
  | { event: 'chunk'; data: { text: string } }
  | { event: 'done'; data: { fullText: string } }
  | { event: 'error'; data: { message: string; provider?: string } }
  | { event: 'tool_activity'; data: { name: string; status: string; detail?: string } };

type StreamChannel = {
  onmessage: ((event: StreamEvent) => void) | null;
};

export type AIConversationSessionState = {
  input: string;
  isLoading: boolean;
  isTauri: boolean;
  chatMessages: ChatMessage[];
  conversationMemory: ConversationMemory | null;
  currentBook: Book | null;
  bookProgressById: BookProgressById;
  selectedText: string;
  selectedCfiRange: string;
  accumulatedTexts: string[];
  currentChapterContent: string;
  currentChapterContentOffset: number;
  currentChapterSliceTruncatedEnd: boolean;
  currentChapterIndex: number | null;
  currentChapterTitle: string | null;
  settings: Settings;
};

export type AIConversationSessionDeps = {
  getState: () => AIConversationSessionState;
  getLatestConversationMemory: () => ConversationMemory | null;
  setLatestConversationMemory: (memory: ConversationMemory) => void;
  addChatMessage: (message: ChatMessage) => void;
  setConversationMemory: (memory: ConversationMemory | null) => void;
  setInput: (value: string) => void;
  setIsLoading: (value: boolean) => void;
  setStreamingContent: (value: string) => void;
  getStreamingContent: () => string;
  setToolActivity: (value: string | null) => void;
  clearSelectedText: () => void;
  invoke: typeof invoke;
  createChannel: () => StreamChannel;
  requestAnimationFrame: (callback: () => void) => number;
  cancelAnimationFrame: (id: number) => void;
  setTimeout: (callback: () => void, ms: number) => number;
  now: () => number;
  markPerformance: (name: string) => void;
  measurePerformance: (name: string, startMark: string, endMark: string) => void;
  ingestReadingMemory: typeof ingestReadingMemoryDirect;
};

export function createTauriAIConversationSession(
  deps: Omit<
    AIConversationSessionDeps,
    | 'invoke'
    | 'createChannel'
    | 'requestAnimationFrame'
    | 'cancelAnimationFrame'
    | 'setTimeout'
    | 'now'
    | 'markPerformance'
    | 'measurePerformance'
    | 'ingestReadingMemory'
  >,
) {
  return new AIConversationSession({
    ...deps,
    invoke,
    createChannel: () => new Channel<StreamEvent>(),
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    now: () => Date.now(),
    markPerformance: perfMark,
    measurePerformance: perfMeasure,
    ingestReadingMemory: ingestReadingMemoryDirect,
  });
}

export class AIConversationSession {
  private isSending = false;

  constructor(private readonly deps: AIConversationSessionDeps) {}

  async send(overrideText?: string): Promise<void> {
    const state = this.deps.getState();
    const messageToSend = (overrideText ?? state.input).trim();
    if (!messageToSend || state.isLoading || this.isSending) return;
    this.isSending = true;

    const readingContext = this.buildFrozenReadingContext(state);
    const { combinedContext } = buildContextFromReadingSnapshot(readingContext);
    const userMessageTimestamp = this.deps.now();
    const userMessage = createUserChatMessage({
      id: userMessageTimestamp.toString(),
      content: messageToSend,
      timestamp: userMessageTimestamp,
      context: combinedContext,
      contextCfi: readingContext.selection?.cfiRange,
      sourceChapter: readingContext.chapterTitle || readingContext.progress?.currentChapter,
      sourceChapterIndex: readingContext.chapterIndex,
      sourceProgress: readingContext.progress?.percentage,
    });

    this.deps.addChatMessage(userMessage);
    this.deps.setInput('');
    this.deps.setIsLoading(true);
    this.deps.setStreamingContent('');
    this.deps.setToolActivity(null);
    const perfKey = `ai:sendMessage:${userMessage.id}`;
    this.deps.markPerformance(`${perfKey}:start`);
    let streamComplete = false;

    try {
      if (!state.isTauri) {
        const assistantMessage: ChatMessage = {
          id: (this.deps.now() + 1).toString(),
          role: 'assistant',
          content: `（Web 预览模式）你发送了：\n\n${messageToSend}\n\n可以直接选中这段文字验证选中高亮效果。`,
          timestamp: this.deps.now(),
        };
        this.deps.addChatMessage(assistantMessage);
        this.deps.setIsLoading(false);
        return;
      }

      const conversationSummary = await this.ensureConversationMemory(state);
      const request: ChatRequest = buildChatRequest({
        message: messageToSend,
        readingContext,
        conversationSummary,
        chatMessages: state.chatMessages,
        settings: state.settings,
      });

      const onEvent = this.deps.createChannel();
      let fullContent = '';
      let pendingChunks: string[] = [];
      let flushRaf: number | null = null;

      const finalizeContent = () => {
        if (pendingChunks.length > 0) {
          fullContent += pendingChunks.join('');
          pendingChunks = [];
        }
        return fullContent;
      };

      const commitAssistantMessage = createOnceCommitter((content: string) => {
        const assistantMessage: ChatMessage = {
          id: (this.deps.now() + 1).toString(),
          role: 'assistant',
          content,
          timestamp: this.deps.now(),
        };
        this.deps.addChatMessage(assistantMessage);
        void this.autoIngestReadingMemory(state, userMessage, assistantMessage, readingContext);
      });

      const scheduleFlush = () => {
        if (flushRaf !== null) return;
        flushRaf = this.deps.requestAnimationFrame(() => {
          flushRaf = null;
          this.deps.setStreamingContent(finalizeContent());
        });
      };

      onEvent.onmessage = (event: StreamEvent) => {
        switch (event.event) {
          case 'started':
            break;
          case 'chunk':
            pendingChunks.push(event.data.text);
            scheduleFlush();
            break;
          case 'tool_activity':
            this.deps.setToolActivity(event.data.detail ?? null);
            break;
          case 'done': {
            streamComplete = true;
            if (flushRaf !== null) {
              this.deps.cancelAnimationFrame(flushRaf);
              flushRaf = null;
            }
            this.deps.measurePerformance(perfKey, `${perfKey}:start`, `${perfKey}:done`);
            const finalContent = event.data.fullText || finalizeContent();
            commitAssistantMessage(finalContent);
            this.deps.setStreamingContent('');
            this.deps.setToolActivity(null);
            this.deps.setIsLoading(false);
            if (state.selectedText) this.deps.clearSelectedText();
            break;
          }
          case 'error': {
            streamComplete = true;
            if (flushRaf !== null) {
              this.deps.cancelAnimationFrame(flushRaf);
              flushRaf = null;
            }
            this.deps.measurePerformance(perfKey, `${perfKey}:start`, `${perfKey}:error`);
            const providerPrefix = event.data.provider ? `[${event.data.provider}] ` : '';
            this.deps.addChatMessage({
              id: (this.deps.now() + 1).toString(),
              role: 'assistant',
              content: `${providerPrefix}${event.data.message}`,
              timestamp: this.deps.now(),
            });
            this.deps.setStreamingContent('');
            this.deps.setToolActivity(null);
            this.deps.setIsLoading(false);
            this.deps.setInput(messageToSend);
            break;
          }
        }
      };

      await this.deps.invoke('chat_with_ai_streaming', { request, onEvent });

      if (!streamComplete && (fullContent || pendingChunks.length > 0)) {
        this.deps.measurePerformance(perfKey, `${perfKey}:start`, `${perfKey}:fallback`);
        commitAssistantMessage(finalizeContent());
        this.deps.setStreamingContent('');
        this.deps.setToolActivity(null);
        this.deps.setIsLoading(false);
      }
    } catch (error) {
      logger.error('AI error:', error);
      if (streamComplete) return;
      this.deps.addChatMessage({
        id: (this.deps.now() + 1).toString(),
        role: 'assistant',
        content: `AI 请求失败：${error}`,
        timestamp: this.deps.now(),
      });
      this.deps.setStreamingContent('');
      this.deps.setToolActivity(null);
      this.deps.setIsLoading(false);
      this.deps.setInput(messageToSend);
    } finally {
      this.isSending = false;
    }
  }

  async stop(): Promise<void> {
    const state = this.deps.getState();
    try {
      if (!state.isTauri) {
        this.deps.setStreamingContent('');
        this.deps.setToolActivity(null);
        this.deps.setIsLoading(false);
        return;
      }
      await this.deps.invoke('cancel_ai_streaming');
      this.deps.setTimeout(() => {
        if (!this.deps.getState().isLoading) return;
        this.deps.addChatMessage({
          id: (this.deps.now() + 1).toString(),
          role: 'assistant',
          content: this.deps.getStreamingContent()
            ? `${this.deps.getStreamingContent()}\n\n[已停止生成]`
            : '[已停止生成]',
          timestamp: this.deps.now(),
        });
        this.deps.setStreamingContent('');
        this.deps.setToolActivity(null);
        this.deps.setIsLoading(false);
      }, 500);
    } catch (error) {
      logger.error('Failed to cancel AI streaming:', error);
      this.deps.setStreamingContent('');
      this.deps.setToolActivity(null);
      this.deps.setIsLoading(false);
    }
  }

  private buildFrozenReadingContext(state: AIConversationSessionState): ReadingContextSnapshot {
    return buildReadingContextSnapshot({
      book: state.currentBook,
      progress: state.currentBook
        ? state.bookProgressById[state.currentBook.id] || state.currentBook.progress
        : undefined,
      selectedText: state.selectedText,
      selectedCfiRange: state.selectedCfiRange,
      accumulatedTexts: state.accumulatedTexts,
      chapterContent: state.currentChapterContent,
      chapterContentOffset: state.currentChapterContentOffset,
      chapterSliceTruncatedEnd: state.currentChapterSliceTruncatedEnd,
      chapterIndex: state.currentChapterIndex ?? undefined,
      chapterTitle: state.currentChapterTitle ?? undefined,
    });
  }

  private async ensureConversationMemory(state: AIConversationSessionState): Promise<string | undefined> {
    if (!state.settings.aiAutoSummarize || !state.isTauri || state.chatMessages.length <= state.settings.aiContextWindow) {
      return state.conversationMemory?.summary;
    }

    const activeMemory = this.deps.getLatestConversationMemory();
    if (activeMemory?.bookId && state.currentBook?.id && activeMemory.bookId !== state.currentBook.id) {
      return undefined;
    }

    const eligibleMessages = getMessagesToSummarize(state.chatMessages, state.settings.aiContextWindow, activeMemory);
    if (eligibleMessages.length < Math.min(10, state.settings.aiContextWindow)) {
      return activeMemory?.summary;
    }

    const lastFolded = eligibleMessages[eligibleMessages.length - 1];
    const request: SummarizeConversationRequest = {
      existing_summary: activeMemory?.summary,
      messages: eligibleMessages.map(message => ({
        role: message.role,
        content: message.content,
      })),
      book_title: state.currentBook?.title,
    };

    try {
      const summary = await this.deps.invoke<string>('summarize_ai_conversation', { request });
      const trimmedSummary = summary.trim();
      if (!trimmedSummary) return activeMemory?.summary;

      const nextMemory: ConversationMemory = {
        id: activeMemory?.id ?? 'active',
        bookId: state.currentBook?.id,
        bookTitle: state.currentBook?.title,
        summary: trimmedSummary,
        summarizedThroughMessageId: lastFolded.id,
        summarizedThroughTimestamp: lastFolded.timestamp,
        updatedAt: this.deps.now(),
      };
      this.deps.setLatestConversationMemory(nextMemory);
      this.deps.setConversationMemory(nextMemory);
      return trimmedSummary;
    } catch (error) {
      logger.warn('Conversation summary skipped:', error);
      return activeMemory?.summary;
    }
  }

  private async autoIngestReadingMemory(
    state: AIConversationSessionState,
    userMessage: ChatMessage,
    assistantMessage: ChatMessage,
    readingContext: ReadingContextSnapshot,
  ): Promise<void> {
    if (!state.isTauri) return;
    if (!state.settings.readingMemoryAutoIngest || !state.settings.readingMemoryPath || !readingContext.book) return;

    try {
      const ingestInput = buildReadingMemoryIngestInput({
        rootPath: state.settings.readingMemoryPath,
        readingContext,
        userMessage,
        assistantMessage,
      });
      if (!ingestInput) return;
      await this.deps.ingestReadingMemory(ingestInput);
    } catch (error) {
      logger.warn('Reading Memory ingest skipped:', error);
    }
  }
}
