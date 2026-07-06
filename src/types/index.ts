// Legacy category records are read only for local-library migration.
export interface LegacyBookCategory {
  id: string;
  name: string;
  color?: string;
  createdAt: number;
}

// Flat, single-owner library folder.
export interface BookFolder {
  id: string;
  name: string;
  sortOrder: number;
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
  folderId?: string; // Optional Book Folder assignment
  /** @deprecated Old local-library field. Hydration migrates this to folderId. */
  categoryId?: string;
}

// Reading progress
export interface ReadingProgress {
  currentCfi: string; // EPUB CFI location
  percentage: number;
  currentChapter?: string;
}

export interface BookProgressUpdate {
  currentCfi: string;
  percentage: number;
}

// Library state
export interface Library {
  books: Book[];
  folders: BookFolder[];
  /** @deprecated Old local-library field. Hydration migrates this to folders. */
  categories?: LegacyBookCategory[];
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
  aiThinkingEnabled: boolean;
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
