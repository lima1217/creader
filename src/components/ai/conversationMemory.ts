import type { ChatMessage, ConversationMemory } from '../../types';

export function getMessagesToSummarize(
  messages: ChatMessage[],
  contextWindow: number,
  memory?: ConversationMemory | null
): ChatMessage[] {
  if (messages.length <= contextWindow) return [];

  const summarizedThrough = memory?.summarizedThroughTimestamp ?? 0;
  return messages
    .slice(0, Math.max(0, messages.length - contextWindow))
    .filter(message => message.timestamp > summarizedThrough);
}
