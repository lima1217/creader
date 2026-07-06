import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Library, Settings } from '../types';
import { APP_PREF_KEYS, DB_VERSION, db } from './DexieDb';
import { loadAppPref, loadAppPrefWithLegacyMigration, saveAppPref } from './AppPrefsStore';
import { STORAGE_KEYS } from './LocalStore';
import { resetIndexedDb } from './indexedDbTestUtils';

function library(overrides: Partial<Library> = {}): Library {
  return {
    books: [],
    folders: [],
    lastUpdated: 1,
    ...overrides,
  };
}

describe('AppPrefsStore Dexie persistence', () => {
  beforeEach(async () => {
    await resetIndexedDb();
  });

  it('registers appPrefs on the current Dexie schema', () => {
    expect(db.verno).toBe(DB_VERSION);
    expect(db.tables.map(table => table.name).sort()).toEqual([
      'appPrefs',
      'chatMessages',
      'conversationMemory',
      'covers',
    ]);
  });

  it('saves and loads typed app prefs', async () => {
    const settings: Settings = {
      theme: 'dark',
      fontSize: 18,
      fontFamily: 'Georgia',
      lineHeight: 1.8,
      readingMemoryAutoIngest: true,
      aiTextSize: 15,
      aiContextWindow: 20,
      aiToolRounds: 8,
      aiAutoSummarize: false,
      aiThinkingEnabled: false,
    };

    await saveAppPref(APP_PREF_KEYS.settings, settings);
    await expect(loadAppPref<Settings>(APP_PREF_KEYS.settings)).resolves.toEqual(settings);
  });

  it('migrates legacy localStorage prefs once into Dexie', async () => {
    const nextLibrary = library({ lastUpdated: 42 });
    localStorage.setItem(STORAGE_KEYS.library, JSON.stringify({ v: 1, data: nextLibrary }));

    const loaded = await loadAppPrefWithLegacyMigration(
      APP_PREF_KEYS.library,
      library(),
    );

    expect(loaded).toEqual({ value: nextLibrary, persisted: true });
    expect(localStorage.getItem(STORAGE_KEYS.library)).toBeNull();
    await expect(loadAppPref<Library>(APP_PREF_KEYS.library)).resolves.toEqual(nextLibrary);
  });

  it('deduplicates concurrent legacy migrations for the same pref key', async () => {
    const nextLibrary = library({ lastUpdated: 99 });
    localStorage.setItem(STORAGE_KEYS.library, JSON.stringify({ v: 1, data: nextLibrary }));

    const [first, second] = await Promise.all([
      loadAppPrefWithLegacyMigration(APP_PREF_KEYS.library, library()),
      loadAppPrefWithLegacyMigration(APP_PREF_KEYS.library, library()),
    ]);

    expect(first).toEqual({ value: nextLibrary, persisted: true });
    expect(second).toEqual(first);
    expect(localStorage.getItem(STORAGE_KEYS.library)).toBeNull();
  });
});
