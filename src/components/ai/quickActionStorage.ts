import { APP_PREF_KEYS } from '../../services/DexieDb';
import { saveAppPref } from '../../services/AppPrefsStore';
import { saveStored, STORAGE_KEYS } from '../../services/LocalStore';
import { markUserEditedPref, shouldSkipPrefHydrate } from '../../services/appPrefsHydration';
import { isIndexedDbAvailable } from '../../services/indexedDbAvailability';
import {
  defaultQuickActions,
  normalizeQuickActions,
  QUICK_ACTIONS_CHANGED_EVENT,
  type QuickActionConfig,
} from './quickActions';

let cachedQuickActions: QuickActionConfig[] | null = null;

function quickActionsEqual(a: QuickActionConfig[], b: QuickActionConfig[]): boolean {
  return a.length === b.length
    && a.every((action, index) => (
      action.id === b[index]?.id
      && action.label === b[index]?.label
      && action.prompt === b[index]?.prompt
    ));
}

function notifyQuickActionsChanged(): void {
  window.dispatchEvent(new CustomEvent(QUICK_ACTIONS_CHANGED_EVENT));
}

/** Seed quick actions from Dexie at startup (no extra write). */
export function hydrateQuickActionConfigs(actions: QuickActionConfig[]): void {
  if (shouldSkipPrefHydrate('quickActions')) return;

  const normalized = normalizeQuickActions(actions);
  const previous = cachedQuickActions;
  cachedQuickActions = normalized;

  if (previous !== null && !quickActionsEqual(previous, normalized)) {
    notifyQuickActionsChanged();
    return;
  }

  if (previous === null && !quickActionsEqual(defaultQuickActions, normalized)) {
    notifyQuickActionsChanged();
  }
}

export function loadQuickActionConfigs(): QuickActionConfig[] {
  return cachedQuickActions ?? defaultQuickActions;
}

export function saveQuickActionConfigs(actions: QuickActionConfig[]): void {
  markUserEditedPref('quickActions');
  const normalized = normalizeQuickActions(actions);
  cachedQuickActions = normalized;
  if (isIndexedDbAvailable()) {
    void saveAppPref(APP_PREF_KEYS.quickActions, normalized).catch(() => {
      // Persistence failures are non-fatal; the next save may succeed.
    });
  } else {
    saveStored(STORAGE_KEYS.quickActions, normalized);
  }
  notifyQuickActionsChanged();
}

/** Reset the in-memory cache between tests. */
export function resetQuickActionConfigsCache(): void {
  cachedQuickActions = null;
}
