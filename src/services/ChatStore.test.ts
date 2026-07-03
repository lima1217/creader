import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage, ConversationMemory } from '../types';
import { DB_VERSION, db } from './DexieDb';
import { appendChatMessages, clearChatMessages, clearConversationMemory, loadChatMessages, loadConversationMemory, replaceChatMessages, saveConversationMemory } from './ChatStore';
import { resetIndexedDb, seedRawIndexedDb } from './indexedDbTestUtils';

function msg(id: string, timestamp: number, role: ChatMessage['role'] = 'user'): ChatMessage {
  return { id, role, content: `message ${id}`, timestamp };
}

describe('ChatStore Dexie persistence', () => {
  beforeEach(async () => {
    await resetIndexedDb();
  });

  it('has an explicit Dexie schema version for chat and conversation memory', () => {
    expect(db.verno).toBe(DB_VERSION);
    expect(db.tables.map(table => table.name).sort()).toEqual([
      'chatMessages',
      'conversationMemory',
      'covers',
    ]);
  });

  it('hydrates existing raw IndexedDB chat messages in chronological key order', async () => {
    await seedRawIndexedDb(5, {
      chatMessages: [
        { key: '0000000000200:b', value: msg('b', 200, 'assistant') },
        { key: '0000000000100:a', value: msg('a', 100) },
      ],
    });

    await expect(loadChatMessages()).resolves.toEqual([
      msg('a', 100),
      msg('b', 200, 'assistant'),
    ]);
  });

  it('appends, trims, replaces, and clears messages through Dexie', async () => {
    await appendChatMessages([msg('a', 100), msg('b', 200), msg('c', 300)], 2);
    await expect(loadChatMessages()).resolves.toEqual([msg('b', 200), msg('c', 300)]);

    await replaceChatMessages([msg('d', 400), msg('e', 500), msg('f', 600)], 2);
    await expect(loadChatMessages()).resolves.toEqual([msg('e', 500), msg('f', 600)]);

    await clearChatMessages();
    await expect(loadChatMessages()).resolves.toEqual([]);
  });

  it('persists and clears conversation memory without mixing it into chat messages', async () => {
    const memory: ConversationMemory = {
      id: 'memory-1',
      summary: 'Earlier reading context',
      summarizedThroughMessageId: 'b',
      updatedAt: 123,
    };

    await appendChatMessages([msg('a', 100)], 10);
    await saveConversationMemory(memory);

    await expect(loadConversationMemory()).resolves.toEqual(memory);
    await expect(loadChatMessages()).resolves.toEqual([msg('a', 100)]);

    await clearConversationMemory();
    await expect(loadConversationMemory()).resolves.toBeNull();
    await expect(loadChatMessages()).resolves.toEqual([msg('a', 100)]);
  });

  it('hydrates existing raw IndexedDB conversation memory', async () => {
    const memory: ConversationMemory = {
      id: 'memory-legacy',
      summary: 'Legacy summary',
      updatedAt: 456,
    };
    await seedRawIndexedDb(5, {
      conversationMemory: [{ key: 'active', value: memory }],
    });

    await expect(loadConversationMemory()).resolves.toEqual(memory);
  });
});
