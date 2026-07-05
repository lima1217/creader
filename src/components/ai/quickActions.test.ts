import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_PREF_KEYS } from '../../services/DexieDb';
import { loadAppPref } from '../../services/AppPrefsStore';
import { resetIndexedDb } from '../../services/indexedDbTestUtils';
import { loadStored, STORAGE_KEYS } from '../../services/LocalStore';
import type { QuickActionConfig } from './quickActions';
import {
  defaultQuickActions,
  getMissingDefaultQuickActions,
  hydrateQuickActionConfigs,
  normalizeQuickActions,
  QUICK_ACTIONS_CHANGED_EVENT,
  resetQuickActionConfigsCache,
} from './quickActions';
import { loadQuickActionConfigs, saveQuickActionConfigs } from './quickActionStorage';

function validAction(overrides: Partial<QuickActionConfig> = {}): QuickActionConfig {
  return { id: 'a', label: '解释', prompt: '解释选中的内容。', ...overrides };
}

beforeEach(async () => {
  await resetIndexedDb();
  resetQuickActionConfigsCache();
  vi.unstubAllGlobals();
});

describe('quickActions pure helpers', () => {
  describe('normalizeQuickActions', () => {
    it('returns the default actions for non-array input', () => {
      expect(normalizeQuickActions(null)).toBe(defaultQuickActions);
      expect(normalizeQuickActions({})).toBe(defaultQuickActions);
      expect(normalizeQuickActions('not-an-array')).toBe(defaultQuickActions);
    });

    it('drops entries that are not valid quick-action configs', () => {
      const result = normalizeQuickActions([
        validAction(),
        { id: 'b', label: 'x', prompt: 'y', icon: 'unknown-icon' },
        { id: 'c', label: 'x' },
        'nope',
        null,
      ]);
      expect(result.map((a) => a.id)).toEqual(['a', 'b']);
    });

    it('strips legacy icon fields from stored configs', () => {
      const result = normalizeQuickActions([
        { id: 'a', label: '解释', prompt: 'prompt', icon: 'explain' },
      ]);
      expect(result).toEqual([validAction({ id: 'a', label: '解释', prompt: 'prompt' })]);
      expect(result[0]).not.toHaveProperty('icon');
    });

    it('trims label and prompt and drops entries that become empty', () => {
      const result = normalizeQuickActions([
        validAction({ id: 'a', label: '  解释  ', prompt: '  prompt  ' }),
        validAction({ id: 'b', label: '   ', prompt: 'y' }),
        validAction({ id: 'c', label: 'x', prompt: '' }),
      ]);
      expect(result.map((a) => a.id)).toEqual(['a']);
      expect(result[0].label).toBe('解释');
      expect(result[0].prompt).toBe('prompt');
    });
  });

  describe('getMissingDefaultQuickActions', () => {
    it('returns all defaults when nothing is present', () => {
      expect(getMissingDefaultQuickActions([])).toEqual(defaultQuickActions);
    });

    it('returns only the default ids not present in the input', () => {
      const present = defaultQuickActions.filter((a) => a.id !== 'translate' && a.id !== 'explain');
      const missing = getMissingDefaultQuickActions(present);
      expect(missing.map((a) => a.id).sort()).toEqual(['explain', 'translate']);
    });

    it('returns an empty list when all defaults are present', () => {
      expect(getMissingDefaultQuickActions(defaultQuickActions)).toEqual([]);
    });
  });

  describe('loadQuickActionConfigs / saveQuickActionConfigs', () => {
    it('returns the default actions when nothing is stored', () => {
      expect(loadQuickActionConfigs()).toEqual(defaultQuickActions);
    });

    it('round-trips a saved config list and dispatches the change event', async () => {
      const dispatched = vi.fn();
      window.addEventListener(QUICK_ACTIONS_CHANGED_EVENT, dispatched);

      const custom = [validAction({ id: 'custom-1', label: 'Mine', prompt: 'Go' })];
      saveQuickActionConfigs(custom);

      expect(dispatched).toHaveBeenCalledTimes(1);
      window.removeEventListener(QUICK_ACTIONS_CHANGED_EVENT, dispatched);

      await expect(loadAppPref<QuickActionConfig[]>(APP_PREF_KEYS.quickActions)).resolves.toEqual(custom);
      expect(loadQuickActionConfigs()).toEqual(custom);
    });

    it('normalizes on save, dropping invalid entries and legacy icon fields', async () => {
      const invalid = { id: 'drop', label: 'x', prompt: '' } as unknown as QuickActionConfig;
      saveQuickActionConfigs([validAction({ id: 'keep' }), invalid]);
      const loaded = loadQuickActionConfigs();
      expect(loaded.map((a) => a.id)).toEqual(['keep']);
      expect(loaded[0]).not.toHaveProperty('icon');

      const stored = await loadAppPref<QuickActionConfig[]>(APP_PREF_KEYS.quickActions);
      expect(stored?.map((a) => a.id)).toEqual(['keep']);
      expect(stored?.[0]).not.toHaveProperty('icon');
    });

    it('hydrates the in-memory cache without scheduling another Dexie write', () => {
      const custom = [validAction({ id: 'hydrated', label: 'Hydrated', prompt: 'Go' })];
      hydrateQuickActionConfigs(custom);
      expect(loadQuickActionConfigs()).toEqual(custom);
    });

    it('dispatches a change event when hydration updates custom quick actions', () => {
      const dispatched = vi.fn();
      window.addEventListener(QUICK_ACTIONS_CHANGED_EVENT, dispatched);

      const custom = [validAction({ id: 'hydrated', label: 'Hydrated', prompt: 'Go' })];
      hydrateQuickActionConfigs(custom);

      expect(dispatched).toHaveBeenCalledTimes(1);
      window.removeEventListener(QUICK_ACTIONS_CHANGED_EVENT, dispatched);
    });

    it('does not overwrite quick actions saved before hydration completes', () => {
      const custom = [validAction({ id: 'user', label: 'User', prompt: 'Mine' })];
      saveQuickActionConfigs(custom);
      hydrateQuickActionConfigs([validAction({ id: 'stale', label: 'Stale', prompt: 'Old' })]);
      expect(loadQuickActionConfigs()).toEqual(custom);
    });

    it('falls back to localStorage when IndexedDB is unavailable', () => {
      vi.stubGlobal('indexedDB', undefined);
      const custom = [validAction({ id: 'local', label: 'Local', prompt: 'Save locally' })];

      saveQuickActionConfigs(custom);

      expect(loadStored(STORAGE_KEYS.quickActions, [])).toEqual(custom);
      expect(loadQuickActionConfigs()).toEqual(custom);
    });
  });
});
