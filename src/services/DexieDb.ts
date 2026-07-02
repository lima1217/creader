import Dexie, { type Table } from 'dexie';
import type { ChatMessage, ConversationMemory } from '../types';

export const DB_NAME = 'creader';
export const DB_VERSION = 6;

const STORE_SCHEMA = {
  covers: '',
  locations: '',
  chatMessages: '',
  conversationMemory: '',
} as const;

class CReaderDexie extends Dexie {
  covers!: Table<Blob, string>;
  locations!: Table<string, string>;
  chatMessages!: Table<ChatMessage, string>;
  conversationMemory!: Table<ConversationMemory, string>;

  constructor() {
    super(DB_NAME);

    // Version 5 matches the raw IndexedDB schema: outbound keys, no indexes.
    this.version(5).stores(STORE_SCHEMA);
    this.version(DB_VERSION).stores({
      ...STORE_SCHEMA,
      searchText: null,
      searchResults: null,
    });
  }
}

export const db = new CReaderDexie();

export async function deleteCReaderDbForTests(): Promise<void> {
  db.close({ disableAutoOpen: false });
  await Dexie.delete(DB_NAME);
}
