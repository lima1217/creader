import type { AppPrefKey } from '../services/DexieDb';
import { saveAppPref } from '../services/AppPrefsStore';
import { useDebouncedPersist } from './useDebouncedPersist';

function persistToDexie<T>(key: AppPrefKey, value: T): void {
  void saveAppPref(key, value).catch(() => {
    // Persistence failures are non-fatal; the next debounced write may succeed.
  });
}

export function useDebouncedDexiePersist<T>(
  key: AppPrefKey,
  value: T,
  delayMs: number,
  options?: { skipInitial?: boolean; enabled?: boolean },
): void {
  useDebouncedPersist(key, value, delayMs, persistToDexie, options);
}
