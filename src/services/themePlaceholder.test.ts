import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS, loadStored } from './LocalStore';
import { readThemePlaceholder, writeThemePlaceholder } from './themePlaceholder';
import { DEFAULT_SETTINGS, getInitialSettings } from '../stores/app/initialState';

describe('themePlaceholder', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips the last-known theme for synchronous first paint', () => {
    writeThemePlaceholder('dark');
    expect(readThemePlaceholder()).toBe('dark');
    expect(getInitialSettings(DEFAULT_SETTINGS).theme).toBe('dark');
  });

  it('prefers legacy settings storage when both sources exist', () => {
    writeThemePlaceholder('dark');
    localStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({ v: 1, data: { theme: 'light' } }),
    );
    expect(getInitialSettings(DEFAULT_SETTINGS).theme).toBe('light');
  });

  it('falls back to defaults when no placeholder exists', () => {
    expect(readThemePlaceholder()).toBeNull();
    expect(getInitialSettings(DEFAULT_SETTINGS).theme).toBe(DEFAULT_SETTINGS.theme);
    expect(loadStored(STORAGE_KEYS.settings, {})).toEqual({});
  });
});
