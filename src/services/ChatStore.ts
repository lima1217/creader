import type { ChatMessage, ConversationMemory } from '../types';
import { MAX_CHAT_MESSAGES_STORED } from '../constants';
import { STORES } from './Db';
import { idbClear, requestToPromise, withTx } from './idb';

const STORE_NAME = STORES.chatMessages;
const MEMORY_STORE_NAME = STORES.conversationMemory;
const ACTIVE_MEMORY_KEY = 'active';

function messageKey(msg: ChatMessage): string {
  // Preserve chronological ordering when iterating via cursor.
  const ts = String(msg.timestamp ?? 0).padStart(13, '0');
  return `${ts}:${msg.id}`;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as any;
  return typeof v.id === 'string' && (v.role === 'user' || v.role === 'assistant') && typeof v.content === 'string';
}

function isConversationMemory(value: unknown): value is ConversationMemory {
  if (!value || typeof value !== 'object') return false;
  const v = value as any;
  return typeof v.id === 'string'
    && typeof v.summary === 'string'
    && typeof v.updatedAt === 'number';
}

export async function loadChatMessages(limit = MAX_CHAT_MESSAGES_STORED): Promise<ChatMessage[]> {
  return await withTx(STORE_NAME, 'readonly', async (store) => {
    const messages: ChatMessage[] = [];

    await new Promise<void>((resolve, reject) => {
      const req = store.openCursor();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        const value = cursor.value as unknown;
        if (isChatMessage(value)) messages.push(value);
        cursor.continue();
      };
    });

    if (messages.length <= limit) return messages;
    return messages.slice(-limit);
  });
}

export async function appendChatMessages(
  messages: ChatMessage[],
  limit = MAX_CHAT_MESSAGES_STORED
): Promise<void> {
  if (messages.length === 0) return;

  await withTx(STORE_NAME, 'readwrite', async (store) => {
    for (const msg of messages) {
      store.put(msg as any, messageKey(msg));
    }

    const count = await requestToPromise(store.count());
    const overflow = count - limit;
    if (overflow <= 0) return;

    let removed = 0;
    await new Promise<void>((resolve, reject) => {
      const req = store.openCursor();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        cursor.delete();
        removed += 1;
        if (removed >= overflow) return resolve();
        cursor.continue();
      };
    });
  });
}

export async function replaceChatMessages(
  messages: ChatMessage[],
  limit = MAX_CHAT_MESSAGES_STORED
): Promise<void> {
  const trimmed = messages.slice(-limit);
  await idbClear(STORE_NAME);
  await appendChatMessages(trimmed, limit);
}

export async function clearChatMessages(): Promise<void> {
  await idbClear(STORE_NAME);
}

export async function loadConversationMemory(): Promise<ConversationMemory | null> {
  return await withTx(MEMORY_STORE_NAME, 'readonly', async (store) => {
    const value = await requestToPromise(store.get(ACTIVE_MEMORY_KEY));
    return isConversationMemory(value) ? value : null;
  });
}

export async function saveConversationMemory(memory: ConversationMemory): Promise<void> {
  await withTx(MEMORY_STORE_NAME, 'readwrite', async (store) => {
    store.put(memory as any, ACTIVE_MEMORY_KEY);
  });
}

export async function clearConversationMemory(): Promise<void> {
  await idbClear(MEMORY_STORE_NAME);
}
