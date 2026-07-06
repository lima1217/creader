import type { Settings, Library, ReadingProgress } from '../../types';
import { normalizeFontFamilyKey } from '../../components/reader/fontCatalog';
import { loadStored, STORAGE_KEYS } from '../../services/LocalStore';
import { readThemePlaceholder } from '../../services/themePlaceholder';
import {
  clampAIContextWindow,
  clampAITextSize,
  clampAIToolRounds,
} from '../../domain/aiSettingsBounds';

export type BookProgressById = Record<string, ReadingProgress & { lastReadAt: number }>;

export const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  fontSize: 16,
  fontFamily: 'serif-latin',
  lineHeight: 1.6,
  readingMemoryPath: undefined,
  readingMemoryAutoIngest: true,
  aiTextSize: 14,
  aiContextWindow: 20,
  aiToolRounds: 10,
  aiAutoSummarize: true,
  aiThinkingEnabled: false,
};

const EMPTY_LIBRARY: Library = { books: [], folders: [], lastUpdated: Date.now() };

function normalizeProgress(progress: ReadingProgress): ReadingProgress {
  const cfi = progress.currentCfi;
  if (typeof cfi === 'string' && (cfi.startsWith('page:') || cfi.startsWith('scroll:'))) {
    return {
      ...progress,
      currentCfi: '',
    };
  }

  return progress;
}

function asStoredEntry(value: unknown): (ReadingProgress & { lastReadAt: number }) | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as any;

  if (typeof v.percentage === 'number' && typeof v.lastReadAt === 'number' && typeof v.currentCfi === 'string') {
    const { lastReadAt, ...progress } = v as ReadingProgress & { lastReadAt: number };
    return { ...normalizeProgress(progress), lastReadAt };
  }

  // Legacy format: { currentCfi, percentage, lastReadAt }
  if (typeof v.percentage === 'number' && typeof v.currentCfi === 'string') {
    const lastReadAt = typeof v.lastReadAt === 'number' ? v.lastReadAt : 0;
    const progress: ReadingProgress = normalizeProgress({
      currentCfi: v.currentCfi,
      percentage: v.percentage,
    });
    return { ...progress, lastReadAt };
  }

  return null;
}

export { normalizeLibrary } from '../../domain/libraryNormalization';

export function getEmptyLibrary(): Library {
  return { ...EMPTY_LIBRARY, lastUpdated: Date.now() };
}

export function resolveSettings(stored: Partial<Settings>, defaultSettings: Settings): Settings {
  return {
    ...defaultSettings,
    ...stored,
    // Sepia was retired in Astryx Phase 1; coerce any stale persisted value to light.
    theme: stored.theme === 'dark' ? 'dark' : 'light',
    aiTextSize: typeof stored.aiTextSize === 'number'
      ? clampAITextSize(stored.aiTextSize)
      : defaultSettings.aiTextSize,
    aiContextWindow: typeof stored.aiContextWindow === 'number'
      ? clampAIContextWindow(stored.aiContextWindow)
      : defaultSettings.aiContextWindow,
    aiToolRounds: typeof stored.aiToolRounds === 'number'
      ? clampAIToolRounds(stored.aiToolRounds)
      : defaultSettings.aiToolRounds,
    aiAutoSummarize: typeof stored.aiAutoSummarize === 'boolean'
      ? stored.aiAutoSummarize
      : defaultSettings.aiAutoSummarize,
    aiThinkingEnabled: typeof stored.aiThinkingEnabled === 'boolean'
      ? stored.aiThinkingEnabled
      : defaultSettings.aiThinkingEnabled,
    fontFamily: typeof stored.fontFamily === 'string'
      ? normalizeFontFamilyKey(stored.fontFamily)
      : defaultSettings.fontFamily,
  };
}

export function resolveBookProgressById(
  stored: Record<string, unknown>,
  legacyLibrary?: Library,
): BookProgressById {
  const migrated: BookProgressById = {};
  for (const [id, raw] of Object.entries(stored)) {
    const entry = asStoredEntry(raw);
    if (entry) migrated[id] = entry;
  }
  if (Object.keys(migrated).length > 0) return migrated;

  const library = legacyLibrary ?? getEmptyLibrary();
  const seeded: BookProgressById = {};
  for (const book of library.books) {
    const normalized = normalizeProgress(book.progress);
    seeded[book.id] = {
      ...normalized,
      lastReadAt: book.lastReadAt ?? 0,
    };
  }
  return seeded;
}

/** Sync placeholder for first paint — Dexie hydration replaces persisted values. */
export function getInitialSettings(defaultSettings: Settings): Settings {
  if (typeof localStorage === 'undefined') {
    return resolveSettings({}, defaultSettings);
  }

  const legacy = loadStored<Partial<Settings>>(STORAGE_KEYS.settings, {});
  const placeholderTheme = readThemePlaceholder();
  const merged = placeholderTheme && legacy.theme === undefined
    ? { ...legacy, theme: placeholderTheme }
    : legacy;
  return resolveSettings(merged, defaultSettings);
}

/** @deprecated Sync init only — startup hydration from Dexie replaces persisted values. */
export function getInitialLibrary(): Library {
  return getEmptyLibrary();
}

/** @deprecated Sync init only — startup hydration from Dexie replaces persisted values. */
export function getInitialBookProgressById(): BookProgressById {
  return {};
}
