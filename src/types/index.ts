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
export type Theme = 'light' | 'dark' | 'sepia';

// App settings
export interface Settings {
  theme: Theme;
  fontSize: number; // 12-24
  fontFamily: string;
  lineHeight: number; // 1.4-2.0
  allowEpubScripts: boolean;
  allowAIDangerousPermissions: boolean;
}

// AI Chat message
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  context?: string; // Selected text from book
}

// Navigation item (chapter)
export interface NavItem {
  id: string;
  href: string;
  label: string;
  subitems?: NavItem[];
}
