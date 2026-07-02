import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../services/LocalStore';
import type { QuickActionConfig } from './quickActions';
import {
  defaultQuickActions,
  getMissingDefaultQuickActions,
  hydrateQuickActions,
  loadQuickActionConfigs,
  normalizeQuickActions,
  QUICK_ACTIONS_CHANGED_EVENT,
  saveQuickActionConfigs,
} from './quickActions';

function validAction(overrides: Partial<QuickActionConfig> = {}): QuickActionConfig {
  return { id: 'a', label: '解释', prompt: '解释选中的内容。', icon: 'explain', ...overrides };
}

beforeEach(() => {
  localStorage.clear();
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
        { id: 'c', label: 'x', prompt: 'y' },
        'nope',
        null,
      ]);
      expect(result.map((a) => a.id)).toEqual(['a']);
    });

    it('trims label and prompt and drops entries that become empty', () => {
      const result = normalizeQuickActions([
        validAction({ id: 'a', label: '  解释  ', prompt: '  prompt  ' }),
        validAction({ id: 'b', label: '   ', prompt: 'y', icon: 'explain' }),
        validAction({ id: 'c', label: 'x', prompt: '', icon: 'explain' }),
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

  describe('hydrateQuickActions', () => {
    it('maps each config to a runtime action with an iconKey and icon node', () => {
      const hydrated = hydrateQuickActions([validAction({ icon: 'translate' })]);
      expect(hydrated).toHaveLength(1);
      expect(hydrated[0].iconKey).toBe('translate');
      expect(hydrated[0].icon).toBeDefined();
    });
  });

  describe('loadQuickActionConfigs / saveQuickActionConfigs', () => {
    it('returns the default actions when nothing is stored', () => {
      expect(loadQuickActionConfigs()).toEqual(defaultQuickActions);
    });

    it('round-trips a saved config list and dispatches the change event', () => {
      const dispatched = vi.fn();
      window.addEventListener(QUICK_ACTIONS_CHANGED_EVENT, dispatched);

      const custom = [validAction({ id: 'custom-1', label: 'Mine', prompt: 'Go' })];
      saveQuickActionConfigs(custom);

      expect(dispatched).toHaveBeenCalledTimes(1);
      window.removeEventListener(QUICK_ACTIONS_CHANGED_EVENT, dispatched);

      const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.quickActions) ?? 'null');
      expect(raw).toEqual(custom);

      expect(loadQuickActionConfigs()).toEqual(custom);
    });

    it('normalizes on save, dropping invalid entries', () => {
      const corrupted = { id: 'drop', label: 'x', prompt: 'y', icon: 'bogus' } as unknown as QuickActionConfig;
      saveQuickActionConfigs([validAction({ id: 'keep' }), corrupted]);
      const loaded = loadQuickActionConfigs();
      expect(loaded.map((a) => a.id)).toEqual(['keep']);
    });
  });
});
