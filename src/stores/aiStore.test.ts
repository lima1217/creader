import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/ChatStore', () => ({
  appendChatMessages: vi.fn().mockResolvedValue(undefined),
  clearChatMessages: vi.fn().mockResolvedValue(undefined),
  clearConversationMemory: vi.fn().mockResolvedValue(undefined),
  replaceChatMessages: vi.fn().mockResolvedValue(undefined),
  saveConversationMemory: vi.fn().mockResolvedValue(undefined),
}));

import { useAIStore } from './aiStore';

describe('aiStore chapter metadata', () => {
  beforeEach(() => {
    useAIStore.setState({
      currentChapterContent: '',
      currentChapterContentOffset: 0,
      currentChapterSliceTruncatedEnd: false,
      currentChapterContentLength: 0,
      currentChapterIndex: null,
      currentChapterTitle: null,
      currentChapterRemainingPercent: null,
      chatMessages: [],
      conversationMemory: null,
    });
  });

  it('exposes chapter content length for chrome without requiring the full slice', () => {
    useAIStore.getState().setCurrentChapterSlice({
      content: 'a'.repeat(2500),
      offset: 0,
      truncatedEnd: false,
    });

    const state = useAIStore.getState();
    expect(state.currentChapterContentLength).toBe(2500);
    expect(state.currentChapterContent).toHaveLength(2500);
  });

  it('clears chapter content length when the slice is emptied', () => {
    useAIStore.getState().setCurrentChapterSlice({
      content: 'chapter body',
      offset: 0,
      truncatedEnd: false,
    });
    useAIStore.getState().setCurrentChapterSlice({
      content: '',
      offset: 0,
      truncatedEnd: false,
    });

    expect(useAIStore.getState().currentChapterContentLength).toBe(0);
  });
});
