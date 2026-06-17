import type { ChatRequest } from '../../domain/aiRequest';
import type { AIProviderConfig, AIProviderStatus } from '../../types';

/**
 * AI Panel Type Definitions
 */

export type { ChatRequest, AIProviderConfig, AIProviderStatus };

export interface SummarizeConversationRequest {
    existing_summary?: string;
    messages: { role: string; content: string }[];
    book_title?: string;
}

// Stream events from AI backend
export type StreamEvent =
    | { event: 'started'; data: { provider: string } }
    | { event: 'chunk'; data: { text: string } }
    | { event: 'done'; data: { fullText: string } }
    | { event: 'error'; data: { message: string; provider?: string } };

// Quick action button configuration
export interface QuickAction {
    label: string;
    prompt: string;
    icon: React.ReactNode;
}
