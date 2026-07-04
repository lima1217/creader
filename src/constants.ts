/**
 * Application-wide constants
 * Centralizes magic numbers and configuration values for better maintainability
 */

// ============================================
// UI Constants
// ============================================

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
