import Dexie, { type Table } from 'dexie';
import type { ChatMessage, ConversationMemory } from '../types';

export const DB_NAME = 'creader';
export const DB_VERSION = 8;

export const APP_PREF_KEYS = {
  settings: 'settings',
  library: 'library',
  progress: 'progress',
  quickActions: 'quickActions',
  libraryOrganizerExpandedFolders: 'libraryOrganizerExpandedFolders',
} as const;

export type AppPrefKey = (typeof APP_PREF_KEYS)[keyof typeof APP_PREF_KEYS];

// v5/v6 included the old epubjs generated-location cache. Keep the schema only
// so Dexie can migrate existing users and delete `locations` in the current DB.
const LEGACY_V5_STORE_SCHEMA = {
  covers: '',
  locations: '',
  chatMessages: '',
  conversationMemory: '',
} as const;

const STORE_SCHEMA = {
  covers: '',
  chatMessages: '',
  conversationMemory: '',
  appPrefs: '',
} as const;

class CReaderDexie extends Dexie {
  covers!: Table<Blob, string>;
  chatMessages!: Table<ChatMessage, string>;
  conversationMemory!: Table<ConversationMemory, string>;
  appPrefs!: Table<unknown, string>;

  constructor() {
    super(DB_NAME);

    // Version 5 matches the raw IndexedDB schema: outbound keys, no indexes.
    this.version(5).stores(LEGACY_V5_STORE_SCHEMA);
    this.version(6).stores({
      ...LEGACY_V5_STORE_SCHEMA,
      searchText: null,
      searchResults: null,
    });
    this.version(7).stores({
      covers: '',
      chatMessages: '',
      conversationMemory: '',
      locations: null,
      searchText: null,
      searchResults: null,
    });
    this.version(DB_VERSION).stores(STORE_SCHEMA);
  }
}

export const db = new CReaderDexie();

export async function deleteCReaderDbForTests(): Promise<void> {
  db.close({ disableAutoOpen: false });
  await Dexie.delete(DB_NAME);
}
