import { create } from 'zustand';
import type { ChatMessage, ConversationMemory } from '../types';
import { MAX_CHAT_MESSAGES_STORED } from '../constants';
import {
  appendChatMessages,
  clearChatMessages,
  clearConversationMemory,
  replaceChatMessages,
  saveConversationMemory,
} from '../services/ChatStore';
import { createLogger } from '../utils/logger';

const logger = createLogger('aiStore');

/**
 * AI conversation + current-chapter slice.
 *
 * `chatMessages` and `conversationMemory` are backed by Dexie (IndexedDB):
 * every mutator fires the corresponding async write. Hydration from Dexie on
 * startup (including the one-time legacy localStorage-chat migration) lives in
 * `AppBootstrap`, which calls {@link hydrateChatMessages} /
 * {@link hydrateConversationMemory}. Chapter location fields are ephemeral.
 */
type AIState = {
  currentChapterContent: string;
  currentChapterContentOffset: number;
  currentChapterSliceTruncatedEnd: boolean;
  currentChapterContentLength: number;
  currentChapterIndex: number | null;
  currentChapterTitle: string | null;
  currentChapterRemainingPercent: number | null;
  setCurrentChapterSlice: (slice: { content: string; offset: number; truncatedEnd: boolean }) => void;
  setCurrentChapterLocation: (location: {
    index: number | null;
    title: string | null;
    remainingPercent: number | null;
  }) => void;
  chatMessages: ChatMessage[];
  conversationMemory: ConversationMemory | null;
  addChatMessage: (message: ChatMessage) => void;
  setChatMessages: (messages: ChatMessage[]) => void;
  setConversationMemory: (memory: ConversationMemory | null) => void;
  clearChat: () => void;
};

export const useAIStore = create<AIState>((set, get) => ({
  currentChapterContent: '',
  currentChapterContentOffset: 0,
  currentChapterSliceTruncatedEnd: false,
  currentChapterContentLength: 0,
  currentChapterIndex: null,
  currentChapterTitle: null,
  currentChapterRemainingPercent: null,
  setCurrentChapterSlice: (slice) => set({
    currentChapterContent: slice.content,
    currentChapterContentOffset: slice.offset,
    currentChapterSliceTruncatedEnd: slice.truncatedEnd,
    currentChapterContentLength: slice.content.length,
  }),
  setCurrentChapterLocation: (location) => set({
    currentChapterIndex: location.index,
    currentChapterTitle: location.title,
    currentChapterRemainingPercent: location.remainingPercent,
  }),

  chatMessages: [],
  conversationMemory: null,

  addChatMessage: (message) => {
    set((state) => {
      const next = [...state.chatMessages, message];
      void appendChatMessages([message], MAX_CHAT_MESSAGES_STORED).catch((e) => {
        logger.warn('Failed to persist chat message:', e);
      });
      return { chatMessages: next.length > MAX_CHAT_MESSAGES_STORED ? next.slice(-MAX_CHAT_MESSAGES_STORED) : next };
    });
  },

  setChatMessages: (messages) => {
    set({ chatMessages: messages });
    void replaceChatMessages(messages, MAX_CHAT_MESSAGES_STORED).catch((e) => {
      logger.warn('Failed to persist chat messages:', e);
    });
  },

  setConversationMemory: (memory) => {
    set({ conversationMemory: memory });
    const op = memory ? saveConversationMemory(memory) : clearConversationMemory();
    void op.catch((e) => {
      logger.warn('Failed to persist conversation memory:', e);
    });
  },

  clearChat: () => {
    set({ chatMessages: [] });
    void clearChatMessages().catch((e) => {
      logger.warn('Failed to clear chat messages:', e);
    });
    get().setConversationMemory(null);
  },
}));

/**
 * Bulk-replace chat messages *without* scheduling a Dexie write. Used by the
 * startup hydration path, which seeds the store from data already in IndexedDB
 * (or migrated from legacy localStorage via the Dexie service itself).
 */
export function hydrateChatMessages(messages: ChatMessage[]): void {
  useAIStore.setState({ chatMessages: messages });
}

/** Seed conversation memory from Dexie at startup (no extra write). */
export function hydrateConversationMemory(memory: ConversationMemory | null): void {
  useAIStore.setState({ conversationMemory: memory });
}
