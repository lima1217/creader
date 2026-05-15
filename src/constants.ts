/**
 * Application-wide constants
 * Centralizes magic numbers and configuration values for better maintainability
 */

// ============================================
// UI Constants
// ============================================

/** Height of each book item in the sidebar virtual list (in pixels) */
export const BOOK_ITEM_HEIGHT = 92;

/** Width of the AI panel (in pixels) */
export const AI_PANEL_WIDTH = 380;

/** Minimum width of the AI panel when resizing (in pixels) */
export const AI_PANEL_MIN_WIDTH = 300;

/** Maximum width of the AI panel when resizing (in pixels) */
export const AI_PANEL_MAX_WIDTH = 700;

// ============================================
// Storage Constants
// ============================================

/** Maximum number of chat messages to persist in local storage */
export const MAX_CHAT_MESSAGES_STORED = 100;

export const SEARCH_TEXT_CACHE_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export const SEARCH_TEXT_CACHE_MAX_ENTRIES = 400;
export const SEARCH_TEXT_CACHE_MAX_ENTRY_BYTES = 2 * 1024 * 1024;

// ============================================
// AI Constants
// ============================================

/** Timeout for AI requests (in seconds) - must match backend AI_TIMEOUT_SECS */
export const AI_TIMEOUT_SECONDS = 60;

/** Maximum length of chapter content to send to AI (in characters) */
export const MAX_CHAPTER_CONTENT_LENGTH = 50000;

// ============================================
// Reader Constants
// ============================================

/** Minimum interval between progress updates (in milliseconds) */
export const PROGRESS_UPDATE_INTERVAL_MS = 500;

/** Minimum interval between chapter content extractions (in milliseconds) */
export const CHAPTER_EXTRACT_INTERVAL_MS = 1000;

/** Minimum percentage change to trigger progress update */
export const PROGRESS_UPDATE_THRESHOLD_PERCENT = 1;

// ============================================
// Category Colors
// ============================================

/** Preset colors available for book categories */
export const CATEGORY_COLORS = [
    '#EF4444', '#F97316', '#F59E0B', '#84CC16', '#22C55E',
    '#14B8A6', '#06B6D4', '#3B82F6', '#6366F1', '#A855F7',
    '#EC4899', '#78716C'
] as const;

export type CategoryColor = typeof CATEGORY_COLORS[number];
