import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIConversationSession } from './AIConversationSession';
import type { AIConversationSessionDeps, AIConversationSessionState, StreamEvent } from './AIConversationSession';
import type { Book, ChatMessage, ConversationMemory, Settings } from '../../types';

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
}));
vi.mock('../../utils/perf', () => ({ perfMark: () => {}, perfMeasure: () => {} }));

const baseSettings: Settings = {
  theme: 'light',
  fontSize: 16,
  fontFamily: 'serif',
  customFonts: [],
  lineHeight: 1.6,
  aiTextSize: 14,
  aiContextWindow: 20,
  aiToolRounds: 8,
  aiAutoSummarize: false,
  aiThinkingEnabled: false,
  readingMemoryAutoIngest: false,
  readingMemoryPath: '',
};

const book: Book = {
  id: 'book-1',
  title: 'Book',
  author: 'Author',
  filePath: '/book.epub',
  addedAt: 1,
  progress: { currentCfi: 'epubcfi(/6/2)', percentage: 12, currentChapter: 'Chapter 1' },
};

function createHarness(
  overrides: Partial<AIConversationSessionState> = {},
  options: {
    onChatInvoke?: (channel: { onmessage: ((event: StreamEvent) => void) | null }) => void;
    failChatInvoke?: boolean;
    holdChatInvoke?: boolean;
  } = {},
) {
  let state: AIConversationSessionState = {
    input: 'Explain this',
    isLoading: false,
    isTauri: true,
    chatMessages: [],
    conversationMemory: null,
    currentBook: book,
    bookProgressById: {},
    selectedText: 'frozen quote',
    selectedCfiRange: 'epubcfi(/6/4)',
    accumulatedTexts: [],
    currentChapterContent: 'chapter body',
    currentChapterContentOffset: 0,
    currentChapterSliceTruncatedEnd: false,
    currentChapterIndex: 1,
    currentChapterTitle: 'Chapter 2',
    settings: { ...baseSettings },
    ...overrides,
  };
  let streamingContent = '';
  let latestMemory: ConversationMemory | null = state.conversationMemory;
  let lastChannel: { onmessage: ((event: StreamEvent) => void) | null } | null = null;
  const timeoutQueue: Array<() => void> = [];
  const rafQueue: Array<() => void> = [];
  let now = 1000;
  const ingestCalls: unknown[] = [];
  const invokeCalls: Array<{ cmd: string; args: unknown }> = [];
  let releaseChatInvoke: (() => void) | null = null;
  let toolActivity: string | null = null;

  const deps: AIConversationSessionDeps = {
    getState: () => state,
    getLatestConversationMemory: () => latestMemory,
    setLatestConversationMemory: (memory) => {
      latestMemory = memory;
    },
    addChatMessage: (message) => {
      state = { ...state, chatMessages: [...state.chatMessages, message] };
    },
    setConversationMemory: (memory) => {
      state = { ...state, conversationMemory: memory };
    },
    setInput: (value) => {
      state = { ...state, input: value };
    },
    setIsLoading: (value) => {
      state = { ...state, isLoading: value };
    },
    setStreamingContent: (value) => {
      streamingContent = value;
    },
    getStreamingContent: () => streamingContent,
    setToolActivity: (value) => {
      toolActivity = value;
    },
    clearSelectedText: () => {
      state = { ...state, selectedText: '' };
    },
    invoke: vi.fn(async (cmd: string, args?: unknown) => {
      invokeCalls.push({ cmd, args });
      if (cmd === 'chat_with_ai_streaming' && options.holdChatInvoke) {
        await new Promise<void>(resolve => {
          releaseChatInvoke = resolve;
        });
      }
      if (cmd === 'summarize_ai_conversation') return 'older turns summary';
      if (cmd === 'chat_with_ai_streaming' && options.failChatInvoke) {
        throw new Error('transport failed');
      }
      if (cmd === 'chat_with_ai_streaming' && lastChannel) {
        options.onChatInvoke?.(lastChannel);
      }
      return undefined;
    }) as never,
    createChannel: () => {
      lastChannel = { onmessage: null };
      return lastChannel;
    },
    requestAnimationFrame: (callback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    },
    cancelAnimationFrame: () => {},
    setTimeout: (callback) => {
      timeoutQueue.push(callback);
      return timeoutQueue.length;
    },
    now: () => now++,
    markPerformance: () => {},
    measurePerformance: () => {},
    ingestReadingMemory: vi.fn(async (input: unknown) => {
      ingestCalls.push(input);
      return null;
    }) as never,
  };

  return {
    session: new AIConversationSession(deps),
    get state() {
      return state;
    },
    setState(next: Partial<AIConversationSessionState>) {
      state = { ...state, ...next };
    },
    get streamingContent() {
      return streamingContent;
    },
    setStreamingContent(value: string) {
      streamingContent = value;
    },
    get toolActivity() {
      return toolActivity;
    },
    get lastChannel() {
      return lastChannel;
    },
    invokeCalls,
    ingestCalls,
    releaseChatInvoke() {
      releaseChatInvoke?.();
    },
    flushRaf() {
      rafQueue.splice(0).forEach(callback => callback());
    },
    flushTimeouts() {
      timeoutQueue.splice(0).forEach(callback => callback());
    },
  };
}

describe('AIConversationSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses one frozen Reading Context Snapshot for the user message, request, and Reading Memory ingestion', async () => {
    const h = createHarness({
      settings: {
        ...baseSettings,
        readingMemoryAutoIngest: true,
        readingMemoryPath: '/memory',
      },
    });

    await h.session.send();
    h.setState({
      selectedText: 'changed after send',
      currentBook: { ...book, title: 'Changed Book' },
    });
    h.lastChannel!.onmessage!({ event: 'done', data: { fullText: 'answer' } });

    const user = h.state.chatMessages.find(message => message.role === 'user')!;
    expect(user.context).toBe('frozen quote');
    const streamCall = h.invokeCalls.find(call => call.cmd === 'chat_with_ai_streaming')!;
    expect((streamCall.args as { request: { context?: string; book_title?: string } }).request.context).toBe('frozen quote');
    expect((streamCall.args as { request: { context?: string; book_title?: string } }).request.book_title).toBe('Book');
    expect(h.ingestCalls).toHaveLength(1);
    expect((h.ingestCalls[0] as { selectedContext?: string; book?: { title: string } }).selectedContext).toBe('frozen quote');
    expect((h.ingestCalls[0] as { selectedContext?: string; book?: { title: string } }).book?.title).toBe('Book');
  });

  it('buffers chunks through RAF and commits the done message once', async () => {
    const h = createHarness();
    await h.session.send();

    h.lastChannel!.onmessage!({ event: 'chunk', data: { text: 'a' } });
    h.lastChannel!.onmessage!({ event: 'chunk', data: { text: 'b' } });
    expect(h.streamingContent).toBe('');
    h.flushRaf();
    expect(h.streamingContent).toBe('ab');

    h.lastChannel!.onmessage!({ event: 'done', data: { fullText: 'abc' } });
    h.lastChannel!.onmessage!({ event: 'done', data: { fullText: 'duplicate' } });
    const assistants = h.state.chatMessages.filter((message: ChatMessage) => message.role === 'assistant');
    expect(assistants.map(message => message.content)).toEqual(['abc']);
    expect(h.state.isLoading).toBe(false);
    expect(h.streamingContent).toBe('');
  });

  it('commits provider errors once and restores the input', async () => {
    const h = createHarness({ input: 'retry me' });
    await h.session.send();

    h.lastChannel!.onmessage!({ event: 'error', data: { provider: 'mock', message: 'failed' } });
    const assistant = h.state.chatMessages.find(message => message.role === 'assistant')!;
    expect(assistant.content).toBe('[mock] failed');
    expect(h.state.input).toBe('retry me');
    expect(h.state.isLoading).toBe(false);
  });

  it('prevents a duplicate send while the first send is still in flight', async () => {
    const h = createHarness({}, { holdChatInvoke: true });
    const first = h.session.send('first');
    await Promise.resolve();
    await h.session.send('second');
    h.releaseChatInvoke();
    await first;

    const users = h.state.chatMessages.filter(message => message.role === 'user');
    expect(users.map(message => message.content)).toEqual(['first']);
  });

  it('commits thrown invoke failures once and restores the input', async () => {
    const h = createHarness({ input: 'will fail' }, { failChatInvoke: true });
    await h.session.send();

    const assistants = h.state.chatMessages.filter(message => message.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0].content).toContain('AI 请求失败：Error: transport failed');
    expect(h.state.input).toBe('will fail');
    expect(h.state.isLoading).toBe(false);
  });

  it('falls back to buffered content when invoke resolves without a done event', async () => {
    const h = createHarness({}, {
      onChatInvoke: channel => channel.onmessage!({ event: 'chunk', data: { text: 'partial' } }),
    });
    await h.session.send();

    const assistant = h.state.chatMessages.find(message => message.role === 'assistant')!;
    expect(assistant.content).toBe('partial');
    expect(h.state.isLoading).toBe(false);
  });

  it('shows tool activity as transient state and clears it on done', async () => {
    const h = createHarness();
    await h.session.send();

    h.lastChannel!.onmessage!({
      event: 'tool_activity',
      data: { name: 'get_chapter_text', status: 'started', detail: '正在查阅第 2 章…' },
    });
    expect(h.toolActivity).toBe('正在查阅第 2 章…');

    h.lastChannel!.onmessage!({ event: 'done', data: { fullText: 'answer' } });
    expect(h.toolActivity).toBeNull();
  });

  it('does not set tool activity during a plain text turn', async () => {
    const h = createHarness();
    await h.session.send();

    h.lastChannel!.onmessage!({ event: 'chunk', data: { text: 'plain' } });
    h.lastChannel!.onmessage!({ event: 'done', data: { fullText: 'plain' } });
    expect(h.toolActivity).toBeNull();
  });

  it('clears a previous tool activity hint when a tool fails without detail', async () => {
    const h = createHarness();
    await h.session.send();

    h.lastChannel!.onmessage!({
      event: 'tool_activity',
      data: { name: 'write_reading_memory', status: 'started', detail: '正在写入阅读记忆…' },
    });
    expect(h.toolActivity).toBe('正在写入阅读记忆…');

    // A failure with no detail (e.g. backend returned status=failed but omitted
    // the label) must clear the stale "正在写入…" hint instead of leaving it up.
    h.lastChannel!.onmessage!({
      event: 'tool_activity',
      data: { name: 'write_reading_memory', status: 'failed' },
    });
    expect(h.toolActivity).toBeNull();

    h.lastChannel!.onmessage!({ event: 'done', data: { fullText: 'answer' } });
    expect(h.toolActivity).toBeNull();
  });

  it('commits stopped streaming content after cancel timeout', async () => {
    const h = createHarness({ isLoading: true });
    h.setStreamingContent('partial answer');
    await h.session.stop();
    h.setState({ isLoading: true });
    h.flushTimeouts();

    const assistant = h.state.chatMessages.find(message => message.role === 'assistant')!;
    expect(assistant.content).toBe('partial answer\n\n[已停止生成]');
    expect(h.state.isLoading).toBe(false);
  });
});
