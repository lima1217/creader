import { describe, expect, it } from 'vitest';
import type { ChatMessage, ConversationMemory } from '../../types';
import { getMessagesToSummarize } from './conversationMemory';

function msg(index: number): ChatMessage {
  return {
    id: `m${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index}`,
    timestamp: index,
  };
}

describe('getMessagesToSummarize', () => {
  it('returns no messages when history fits the context window', () => {
    expect(getMessagesToSummarize([msg(1), msg(2)], 5)).toEqual([]);
  });

  it('returns messages outside the recent context window', () => {
    const messages = Array.from({ length: 8 }, (_, index) => msg(index + 1));
    expect(getMessagesToSummarize(messages, 5).map(m => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('skips messages already folded into memory', () => {
    const messages = Array.from({ length: 8 }, (_, index) => msg(index + 1));
    const memory: ConversationMemory = {
      id: 'active',
      summary: 'old summary',
      summarizedThroughTimestamp: 2,
      updatedAt: 10,
    };
    expect(getMessagesToSummarize(messages, 5, memory).map(m => m.id)).toEqual(['m3']);
  });
});
