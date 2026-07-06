import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAIStore } from '../stores/aiStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useProgressStore } from '../stores/progressStore';
import { useUIStore } from '../stores/uiStore';

import { click, installIntersectionObserverStub, mount, settle } from './testUtils';
import { hydrateQuickActionConfigs, resetQuickActionConfigsCache } from './ai/quickActionStorage';

/**
 * AIPanel contract tests — issue #26 (Astryx Phase 2 prefactor).
 *
 * Lock AIPanel behavior against its CURRENT JSX before any Astryx migration
 * (slices #31–#33). AIPanel is the hardest surface: a Tauri Channel-based
 * streaming contract with RAF-buffered chunks, Reading Memory ingestion
 * gating, hidden Conversation summarization, quick-action overflow, and a
 * deliberately quiet input placeholder.
 *
 * Test style follows the Phase 1 contract-mock precedent:
 *  - mock `@tauri-apps/api/core` so `Channel` is a capturable class whose
 *    `onmessage` the test drives with synthetic StreamEvents, and `invoke`
 *    exposes the channel created by sendMessage;
 *  - mock heavy services (Reading Memory ingest, conversation summary);
 *  - drive stores via direct setState and the component via the send button;
 *  - assert on owned behavior: aiStore mutations (chatMessages), the rendered
 *    streaming region, ingestion-gating calls, and the input placeholder.
 *
 * No @testing-library/react. No Astryx components introduced.
 */

// --- vi.hoisted: streaming-channel capture ---------------------------------
//
// sendMessage does `new Channel<StreamEvent>()` then passes it to
// `invoke('chat_with_ai_streaming', { request, onEvent })`. We mock Channel so
// the instance's `onmessage` handler is reachable, letting the test emit
// started/chunk/done/error events to drive the real switch in AIPanel.

const { lastChannel, invokeCalls, resetChannelCapture } = vi.hoisted(() => {
  type Handler = (e: unknown) => void;
  const calls: Array<{ cmd: string; args: unknown }> = [];
  return {
    // The most recent Channel instance — tests read its .onmessage directly.
    lastChannel: { current: null as null | { onmessage: Handler } },
    invokeCalls: calls,
    resetChannelCapture: () => {
      calls.length = 0;
      lastChannel.current = null;
    },
  };
});

// Mock the Tauri core module. Channel captures its onmessage; invoke records
// the call and, for chat_with_ai_streaming, exposes the channel handler.
vi.mock('@tauri-apps/api/core', () => {
  class MockChannel<T> {
    onmessage: ((e: T) => void) | null = null;
    constructor() {
      // Capture this instance so tests can drive it.
      (lastChannel as { current: unknown }).current = this;
    }
  }
  return {
    Channel: MockChannel,
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      invokeCalls.push({ cmd, args });
      if (cmd === 'list_ai_providers') return []; // no providers configured
      if (cmd === 'chat_with_ai_streaming') {
        // The real backend would call onEvent.onmessage with StreamEvents;
        // the test sets lastChannel.current.onmessage and drives it directly.
      }
      return undefined;
    },
    convertFileSrc: (s: string) => s,
  };
});

vi.mock('../utils/tauri', () => ({ isTauriRuntime: () => true }));
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
}));
vi.mock('../utils/perf', () => ({ perfMark: () => {}, perfMeasure: () => {} }));

// Reading Memory ingest — the gating contract under test. Capture calls.
const { ingestCalls, resetIngestCalls } = vi.hoisted(() => {
  const calls: Array<{ rootPath: string; bookTitle: string; question: string; answer: string }> = [];
  return {
    ingestCalls: calls,
    resetIngestCalls: () => calls.length = 0,
  };
});
vi.mock('../services/ReadingMemory', () => ({
  buildReadingMemoryIngestInput: (args: {
    rootPath: string;
    readingContext: { book?: { title?: string } | null };
    userMessage: { content: string };
    assistantMessage: { content: string };
  }) => ({
    rootPath: args.rootPath,
    bookTitle: args.readingContext.book?.title ?? '',
    question: args.userMessage.content,
    answer: args.assistantMessage.content,
  }),
  ingestReadingMemoryDirect: async (input: { rootPath: string; bookTitle: string; question: string; answer: string }) => {
    ingestCalls.push(input);
  },
}));

import { AIPanel } from './AIPanel';

// --- Fixtures --------------------------------------------------------------

function mountPanel() {
  return mount(<AIPanel />);
}

/**
 * Type into the AIPanel composer and click send.
 *
 * The composer is Astryx ChatComposerInput — a contentEditable (role="textbox"),
 * not a textarea — so we set textContent on the editable region and dispatch an
 * input event so the component's onInput → onChange path updates the store.
 * The send affordance is Astryx ChatSendButton, whose underlying button carries
 * aria-label "Send" (set by the component when not streaming).
 */
async function typeAndSend(container: HTMLElement, text: string) {
  const input = container.querySelector('.ai-panel-input [role="textbox"]') as HTMLElement;
  // Drive the contentEditable the way a keystroke would: write the text node
  // and fire an input event so ChatComposerInput's handleInput → emitChange
  // serializes it and calls onChange with the value.
  input.textContent = text;
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await settle();
  const sendBtn = Array.from(container.querySelectorAll('.ai-panel-input button'))
    .find((b) => (b.getAttribute('aria-label') ?? '').toLowerCase() === 'send') as HTMLElement
    ?? Array.from(container.querySelectorAll('.ai-panel-input button')).pop()!;
  click(sendBtn);
  await settle();
}

// --- Setup -----------------------------------------------------------------

beforeEach(() => {
  installIntersectionObserverStub();
  // jsdom does not implement scrollIntoView; AIPanel's auto-scroll RAF calls it.
  Element.prototype.scrollIntoView = () => {};
  // Polyfill RAF so chunk buffering resolves synchronously-enough for tests.
  let rafId = 0;
  const rafQueue: Array<{ id: number; fn: () => void }> = [];
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
    const id = ++rafId;
    rafQueue.push({ id, fn });
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    const i = rafQueue.findIndex((r) => r.id === id);
    if (i >= 0) rafQueue.splice(i, 1);
  });
  (window as unknown as { __flushRaf: () => void }).__flushRaf = () => {
    const queue = rafQueue.splice(0);
    queue.forEach((r) => r.fn());
  };

  resetChannelCapture();
  resetIngestCalls();
  resetQuickActionConfigsCache();
  useAIStore.setState({ chatMessages: [], conversationMemory: null });
  // Settings live under state.settings (not at the top level) — writing them
  // flat would silently no-op the gating reads in AIPanel.
  useSettingsStore.setState({
    settings: {
      ...(useSettingsStore.getState().settings ?? {}),
      aiAutoSummarize: false,
      aiContextWindow: 20,
      aiTextSize: 14,
      readingMemoryAutoIngest: false,
      readingMemoryPath: '',
    } as ReturnType<typeof useSettingsStore.getState>['settings'],
  });
  useSelectionStore.setState({
    selectedText: '',
    selectedCfiRange: '',
    accumulatedTexts: [],
  });
  useLibraryStore.setState({
    library: { books: [], folders: [], lastUpdated: 1 },
    currentBook: null,
  });
  useProgressStore.setState({ bookProgressById: {} });
  useUIStore.setState({ isSidebarOpen: true, isAIPanelOpen: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- Tests -----------------------------------------------------------------

describe('AIPanel — input placeholder', () => {
  it('renders the AI input with an intentionally empty placeholder (quiet reading surface)', () => {
    // AGENTS.md: "The input placeholder is intentionally empty." The migrated
    // composer (Astryx ChatComposerInput, slice #32) preserves this quiet
    // convention rather than adopting Astryx's default "Type a message…" text.
    // ChatComposerInput renders the placeholder inside a sibling div (visible
    // only when the editable is empty), so assert on that node's text.
    const { container } = mountPanel();
    const composer = container.querySelector('.ai-panel-input') as HTMLElement;
    expect(composer).not.toBeNull();
    const editable = container.querySelector('[role="textbox"]') as HTMLElement | null;
    expect(editable).not.toBeNull();
    // The placeholder region (a child div) must be empty or absent — never the
    // Astryx default "Type a message…".
    const placeholderHost = composer.querySelector('[aria-hidden="true"]');
    const placeholderText = placeholderHost?.textContent ?? '';
    expect(placeholderText).toBe('');
    expect(placeholderText).not.toContain('Type a message');
  });
});

describe('AIPanel — composer submit', () => {
  it('submits on Enter (without Shift) via the composer onSubmit path', async () => {
    // Slice #32: Enter-to-submit moved off the old textarea onKeyDown and onto
    // ChatComposerInput's built-in onSubmit. Lock that the Enter key still
    // fires the stream the same way clicking Send does.
    const { container } = mountPanel();
    const editable = container.querySelector('.ai-panel-input [role="textbox"]') as HTMLElement;
    editable.textContent = 'via enter';
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await settle();
    editable.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await settle();

    expect(invokeCalls.some((c) => c.cmd === 'chat_with_ai_streaming')).toBe(true);
    const user = useAIStore.getState().chatMessages.find((m) => m.role === 'user');
    expect(user?.content).toBe('via enter');
  });

  it('does NOT submit on Shift+Enter (newline)', async () => {
    const { container } = mountPanel();
    const editable = container.querySelector('.ai-panel-input [role="textbox"]') as HTMLElement;
    editable.textContent = 'no submit';
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await settle();
    editable.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
    );
    await settle();

    expect(invokeCalls.some((c) => c.cmd === 'chat_with_ai_streaming')).toBe(false);
  });
});

describe('AIPanel — streaming contract', () => {
  it('started sets the streaming state without committing a message', async () => {
    const { container } = mountPanel();
    await typeAndSend(container, 'hello');

    // The channel was created and sendMessage is now awaiting the stream.
    expect(invokeCalls.some((c) => c.cmd === 'chat_with_ai_streaming')).toBe(true);
    const ch = lastChannel.current!;
    expect(ch).not.toBeNull();

    ch.onmessage!({ event: 'started', data: { provider: 'mock' } });
    await settle();

    // Loading/streaming region present, but no assistant message committed yet.
    expect(container.querySelector('.ai-message-streaming, .ai-loading, .ai-streaming-text')).not.toBeNull();
    const assistantMsgs = useAIStore.getState().chatMessages.filter((m) => m.role === 'assistant');
    expect(assistantMsgs).toHaveLength(0);
  });

  it('chunk buffers via RAF: pre-flush differs from post-flush', async () => {
    const { container } = mountPanel();
    await typeAndSend(container, 'stream me');
    const ch = lastChannel.current!;

    ch.onmessage!({ event: 'started', data: { provider: 'mock' } });
    ch.onmessage!({ event: 'chunk', data: { text: 'part1-' } });
    ch.onmessage!({ event: 'chunk', data: { text: 'part2' } });
    await settle();

    // Before flushing the RAF, the streaming region has NOT yet committed the
    // buffered chunks (they sit in pendingChunks until the RAF fires).
    const preFlush = container.querySelector('.ai-streaming-text')?.textContent ?? '';
    // Now flush the queued RAF — this is what commits buffered chunks to view.
    (window as unknown as { __flushRaf: () => void }).__flushRaf();
    await settle();
    const postFlush = container.querySelector('.ai-streaming-text')?.textContent ?? '';

    // Either the pre-flush was empty (RAF hadn't fired) OR it differed from
    // post-flush. The contract: the RAF is what makes buffered chunks visible.
    const rafGatedTheFlush = preFlush === '' || preFlush !== postFlush;
    expect(rafGatedTheFlush).toBe(true);
    expect(postFlush).toContain('part1-part2');
  });

  it('done commits the full assistant message and clears streaming', async () => {
    const { container } = mountPanel();
    await typeAndSend(container, 'finish me');
    const ch = lastChannel.current!;

    ch.onmessage!({ event: 'started', data: { provider: 'mock' } });
    ch.onmessage!({ event: 'chunk', data: { text: 'partial' } });
    (window as unknown as { __flushRaf: () => void }).__flushRaf();
    await settle();

    ch.onmessage!({ event: 'done', data: { fullText: 'partial and done' } });
    await settle();

    const msgs = useAIStore.getState().chatMessages;
    const assistant = msgs.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    expect(assistant!.content).toBe('partial and done');
    // Streaming region cleared after done.
    expect(container.querySelector('.ai-message-streaming')).toBeNull();
  });

  it('shows a tool activity hint while tools run and clears it on done', async () => {
    const { container } = mountPanel();
    await typeAndSend(container, 'look up chapter');
    const ch = lastChannel.current!;

    ch.onmessage!({ event: 'started', data: { provider: 'mock' } });
    ch.onmessage!({
      event: 'tool_activity',
      data: { name: 'get_chapter_text', status: 'started', detail: '正在查阅第 2 章…' },
    });
    await settle();

    expect(container.querySelector('.ai-tool-activity')?.textContent).toContain('正在查阅第 2 章');

    ch.onmessage!({ event: 'done', data: { fullText: 'chapter summary' } });
    await settle();

    expect(container.querySelector('.ai-tool-activity')).toBeNull();
  });

  it('surfaces a tool failure hint and clears it on done', async () => {
    const { container } = mountPanel();
    await typeAndSend(container, 'write a note');
    const ch = lastChannel.current!;

    ch.onmessage!({ event: 'started', data: { provider: 'mock' } });
    ch.onmessage!({
      event: 'tool_activity',
      data: {
        name: 'write_reading_memory',
        status: 'failed',
        detail: '写入阅读记忆失败',
      },
    });
    await settle();

    expect(container.querySelector('.ai-tool-activity')?.textContent).toContain(
      '写入阅读记忆失败',
    );

    ch.onmessage!({ event: 'done', data: { fullText: 'could not save' } });
    await settle();

    expect(container.querySelector('.ai-tool-activity')).toBeNull();
  });

  it('does not show tool activity hints during a plain text turn', async () => {
    const { container } = mountPanel();
    await typeAndSend(container, 'plain answer');
    const ch = lastChannel.current!;

    ch.onmessage!({ event: 'started', data: { provider: 'mock' } });
    ch.onmessage!({ event: 'chunk', data: { text: 'hello' } });
    (window as unknown as { __flushRaf: () => void }).__flushRaf();
    ch.onmessage!({ event: 'done', data: { fullText: 'hello' } });
    await settle();

    expect(container.querySelector('.ai-tool-activity')).toBeNull();
  });

  it('error pushes an error message and clears streaming', async () => {
    const { container } = mountPanel();
    await typeAndSend(container, 'fail me');
    const ch = lastChannel.current!;

    ch.onmessage!({ event: 'started', data: { provider: 'mock' } });
    ch.onmessage!({ event: 'error', data: { message: 'upstream blew up', provider: 'mock' } });
    await settle();

    const msgs = useAIStore.getState().chatMessages;
    const assistant = msgs.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    expect(assistant!.content).toContain('upstream blew up');
    expect(assistant!.content).toContain('[mock]');
    expect(container.querySelector('.ai-message-streaming')).toBeNull();
  });
});

describe('AIPanel — quick-action overflow', () => {
  function seedQuickActions(count: number) {
    const actions = Array.from({ length: count }, (_, i) => ({
      id: `qa-${i}`,
      label: `Action ${i}`,
      prompt: `prompt ${i}`,
    }));
    hydrateQuickActionConfigs(actions);
  }

  it('renders up to 6 quick actions as direct buttons', () => {
    seedQuickActions(5);
    const { container } = mountPanel();
    // Direct buttons live in the margin-actions region; each has a label.
    const directLabels = Array.from(container.querySelectorAll('.ai-margin-action'))
      .map((b) => b.textContent?.trim())
      .filter((t): t is string => !!t && t !== '');
    // 5 actions → 5 direct buttons, no overflow menu.
    expect(directLabels.filter((l) => l.startsWith('Action '))).toHaveLength(5);
    expect(container.querySelector('.ai-margin-more')).toBeNull();
  });

  it('moves the excess (>6) into the overflow more menu', async () => {
    seedQuickActions(8);
    const { container } = mountPanel();
    // The overflow affordance is an Astryx MoreMenu (three-dot trigger). Its
    // menu items render in a portal under document.body as [role="menuitem"].
    const moreTrigger = container.querySelector('.ai-margin-more') as HTMLElement | null;
    expect(moreTrigger).not.toBeNull();
    click(moreTrigger!);
    await settle();
    const overflowItems = Array.from(document.body.querySelectorAll('[role="menuitem"]'));
    const labels = overflowItems.map((el) => el.textContent?.trim() ?? '');
    // The overflow holds items beyond index 6 (Action 6, Action 7).
    expect(labels.some((l) => l.includes('Action 6'))).toBe(true);
    expect(labels.some((l) => l.includes('Action 7'))).toBe(true);
  });
});

describe('AIPanel — conversation summarization stays hidden', () => {
  it('never renders the auto-summary as a chat message', async () => {
    // With aiAutoSummarize off and few messages, no summary is produced, so
    // nothing should leak as a rendered message. The invariant: any summary
    // lives only in the hidden ConversationMemory, never in chatMessages.
    const { container } = mountPanel();
    await typeAndSend(container, 'hello');
    const ch = lastChannel.current!;
    ch.onmessage!({ event: 'done', data: { fullText: 'hi back' } });
    await settle();

    const msgs = useAIStore.getState().chatMessages;
    // Only the user + assistant pair — no synthetic summary message.
    expect(msgs.every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true);
    expect(msgs).toHaveLength(2);
    // And nothing summary-shaped rendered in the panel.
    expect(container.textContent).not.toContain('summary');
    expect(container.textContent).not.toContain('Summary');
  });
});

describe('AIPanel — Reading Memory ingestion gating', () => {
  it('does NOT ingest an ordinary message when auto-ingest is off', async () => {
    useSettingsStore.setState({
      settings: {
        ...(useSettingsStore.getState().settings ?? {}),
        readingMemoryAutoIngest: false,
        readingMemoryPath: '/mem',
      } as ReturnType<typeof useSettingsStore.getState>['settings'],
    });
    const { container } = mountPanel();
    await typeAndSend(container, 'summarize this');
    const ch = lastChannel.current!;
    ch.onmessage!({ event: 'done', data: { fullText: 'a plain summary' } });
    await settle();

    expect(ingestCalls).toHaveLength(0);
  });

  it('ingests a durable turn when auto-ingest + path are set and a book is open', async () => {
    // A book must be open for there to be a readingContext.book to ground the note.
    const book = {
      id: 'b1', title: 'Solitude', author: 'A', filePath: '/x', addedAt: 1,
      progress: { currentCfi: '', percentage: 0 },
    };
    useLibraryStore.getState().setLibrary({
      books: [book], folders: [], lastUpdated: 1,
    });
    useLibraryStore.getState().setCurrentBook(book as never);
    useSettingsStore.setState({
      settings: {
        ...(useSettingsStore.getState().settings ?? {}),
        readingMemoryAutoIngest: true,
        readingMemoryPath: '/my/memory',
      } as ReturnType<typeof useSettingsStore.getState>['settings'],
    });

    const { container } = mountPanel();
    await settle(); // let the first render pick up the seeded currentBook
    await typeAndSend(container, 'Explain the core argument');
    const ch = lastChannel.current!;
    ch.onmessage!({ event: 'done', data: { fullText: 'The core argument is X because Y.' } });
    await settle();

    expect(ingestCalls.length).toBeGreaterThanOrEqual(1);
    expect(ingestCalls[0].rootPath).toBe('/my/memory');
    expect(ingestCalls[0].question).toContain('core argument');
    expect(ingestCalls[0].answer).toContain('core argument is X');
  });
});
