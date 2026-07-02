import type { ChatMessage, ConversationMemory } from '../types';
import { MAX_CHAT_MESSAGES_STORED } from '../constants';
import { db } from './DexieDb';

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
  const values = await db.chatMessages.toArray();
  const messages = values.filter(isChatMessage);
  return messages.length <= limit ? messages : messages.slice(-limit);
}

export async function appendChatMessages(
  messages: ChatMessage[],
  limit = MAX_CHAT_MESSAGES_STORED
): Promise<void> {
  if (messages.length === 0) return;

  await db.transaction('rw', db.chatMessages, async () => {
    for (const msg of messages) {
      await db.chatMessages.put(msg, messageKey(msg));
    }

    const keys = await db.chatMessages.toCollection().primaryKeys();
    const overflow = keys.length - limit;
    if (overflow <= 0) return;
    await db.chatMessages.bulkDelete(keys.slice(0, overflow) as string[]);
  });
}

export async function replaceChatMessages(
  messages: ChatMessage[],
  limit = MAX_CHAT_MESSAGES_STORED
): Promise<void> {
  const trimmed = messages.slice(-limit);
  await db.chatMessages.clear();
  await appendChatMessages(trimmed, limit);
}

export async function clearChatMessages(): Promise<void> {
  await db.chatMessages.clear();
}

export async function loadConversationMemory(): Promise<ConversationMemory | null> {
  const value = await db.conversationMemory.get(ACTIVE_MEMORY_KEY);
  return isConversationMemory(value) ? value : null;
}

export async function saveConversationMemory(memory: ConversationMemory): Promise<void> {
  await db.conversationMemory.put(memory, ACTIVE_MEMORY_KEY);
}

export async function clearConversationMemory(): Promise<void> {
  await db.conversationMemory.clear();
}
