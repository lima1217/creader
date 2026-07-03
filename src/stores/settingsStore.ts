import { create } from 'zustand';
import type { Settings } from '../types';
import { getInitialSettings } from './app/initialState';

/**
 * Persisted app settings. Hydrated synchronously from localStorage via
 * `getInitialSettings`; persistence is driven externally by the debounced
 * write in `AppBootstrap` (same `useDebouncedPersist` path as before).
 */
const defaultSettings: Settings = {
  theme: 'light',
  fontSize: 16,
  fontFamily: 'Georgia',
  lineHeight: 1.6,
  allowEpubScripts: true,
  readingMemoryPath: undefined,
  readingMemoryAutoIngest: true,
  aiTextSize: 14,
  aiContextWindow: 20,
  aiAutoSummarize: true,
};

type SettingsState = {
  settings: Settings;
  setSettings: (settings: Settings) => void;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: getInitialSettings(defaultSettings),
  setSettings: (settings) => set({ settings }),
}));
