import { create } from 'zustand';
import type { Settings } from '../types';
import { DEFAULT_SETTINGS, getInitialSettings } from './app/initialState';
import { markUserEditedPref, shouldSkipPrefHydrate } from '../services/appPrefsHydration';
import { writeThemePlaceholder } from '../services/themePlaceholder';

/**
 * Persisted app settings. Hydrated asynchronously from Dexie on startup;
 * persistence is driven externally by the debounced write in `AppBootstrap`.
 */
type SettingsState = {
  settings: Settings;
  setSettings: (settings: Settings) => void;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: getInitialSettings(DEFAULT_SETTINGS),
  setSettings: (settings) => {
    markUserEditedPref('settings');
    writeThemePlaceholder(settings.theme);
    set({ settings });
  },
}));

/** Seed settings from Dexie at startup (no extra write). */
export function hydrateSettings(settings: Settings): void {
  if (shouldSkipPrefHydrate('settings')) return;
  writeThemePlaceholder(settings.theme);
  useSettingsStore.setState({ settings });
}
