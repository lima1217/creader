/**
 * AI Panel Type Definitions
 */

export interface AIProviderInfo {
    id: string;
    name: string;
    model: string;
    available: boolean;
}

export interface ChatRequest {
    message: string;
    context?: string;
    book_title?: string;
    chapter_content?: string;
    history?: { role: string; content: string }[];
    provider?: string;
    model?: string;
}

// Stream events from AI backend
export type StreamEvent =
    | { event: 'started'; data: { provider: string } }
    | { event: 'chunk'; data: { text: string } }
    | { event: 'done'; data: { fullText: string } }
    | { event: 'error'; data: { message: string } };

// Quick action button configuration
export interface QuickAction {
    label: string;
    prompt: string;
    icon: React.ReactNode;
}
