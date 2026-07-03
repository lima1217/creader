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
 * {@link hydrateConversationMemory}. `currentChapterContent` is ephemeral.
 */
type AIState = {
  currentChapterContent: string;
  setCurrentChapterContent: (content: string) => void;
  chatMessages: ChatMessage[];
  conversationMemory: ConversationMemory | null;
  addChatMessage: (message: ChatMessage) => void;
  setChatMessages: (messages: ChatMessage[]) => void;
  setConversationMemory: (memory: ConversationMemory | null) => void;
  clearChat: () => void;
};

export const useAIStore = create<AIState>((set, get) => ({
  currentChapterContent: '',
  setCurrentChapterContent: (content) => set({ currentChapterContent: content }),

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
