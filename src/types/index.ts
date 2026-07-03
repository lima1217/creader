// Book category
export interface BookCategory {
  id: string;
  name: string;
  color: string; // Hex color for visual identification
  createdAt: number;
}

// Book file format
export type BookFormat = 'epub';

// Book metadata
export interface Book {
  id: string;
  title: string;
  author: string;
  format?: BookFormat; // File format - optional for backwards compatibility
  cover?: string; // base64 or file path
  coverKey?: string;
  filePath: string;
  addedAt: number;
  lastReadAt?: number;
  progress: ReadingProgress;
  categoryId?: string; // Optional category assignment
  searchIndex?: SearchIndexSummary;
}

export type SearchIndexState = 'missing' | 'pending' | 'ready' | 'failed' | 'stale';

export interface SearchIndexSummary {
  state: SearchIndexState;
  error?: string;
  indexedAtMs?: number;
}

// Reading progress
export interface ReadingProgress {
  currentCfi: string; // EPUB CFI location
  percentage: number;
  currentChapter?: string;
}

export type BookProgressUpdate =
  | { kind: 'epub'; currentCfi: string; percentage: number };

// Library state
export interface Library {
  books: Book[];
  categories: BookCategory[];
  lastUpdated: number;
}

// Theme
export type Theme = 'light' | 'dark';

// App settings
export interface Settings {
  theme: Theme;
  fontSize: number; // 12-24
  fontFamily: string;
  lineHeight: number; // 1.4-2.0
  readingMemoryPath?: string;
  readingMemoryAutoIngest: boolean;
  aiTextSize: number; // 13-20
  aiContextWindow: 5 | 20 | 40;
  aiAutoSummarize: boolean;
}

// OpenAI-compatible AI provider configuration. The API key is NOT stored here —
// it lives in app config `ai_keys.env` and is read only by the backend.
export interface AIProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
}

export interface AIProviderStatus extends AIProviderConfig {
  active: boolean;
  hasKey: boolean;
}

// AI Chat message
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  context?: string; // Selected text from book
  contextCfi?: string; // EPUB CFI range for selected text
}

export interface ConversationMemory {
  id: string;
  bookId?: string;
  bookTitle?: string;
  summary: string;
  summarizedThroughMessageId?: string;
  summarizedThroughTimestamp?: number;
  updatedAt: number;
}

// Navigation item (chapter)
export interface NavItem {
  id: string;
  href: string;
  label: string;
  subitems?: NavItem[];
}
