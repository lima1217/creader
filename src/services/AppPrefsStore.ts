import { APP_PREF_KEYS, type AppPrefKey, db } from './DexieDb';
import { loadStored, STORAGE_KEYS } from './LocalStore';

const LEGACY_STORAGE_KEY_BY_PREF: Record<AppPrefKey, string> = {
  [APP_PREF_KEYS.settings]: STORAGE_KEYS.settings,
  [APP_PREF_KEYS.library]: STORAGE_KEYS.library,
  [APP_PREF_KEYS.progress]: STORAGE_KEYS.progress,
  [APP_PREF_KEYS.quickActions]: STORAGE_KEYS.quickActions,
  [APP_PREF_KEYS.libraryOrganizerExpandedFolders]: STORAGE_KEYS.libraryOrganizerExpandedFolders,
};

export type AppPrefLoadResult<T> = {
  value: T;
  persisted: boolean;
};

export async function loadAppPref<T>(key: AppPrefKey): Promise<T | undefined> {
  const value = await db.appPrefs.get(key);
  return value === undefined ? undefined : value as T;
}

export async function saveAppPref<T>(key: AppPrefKey, value: T): Promise<void> {
  await db.appPrefs.put(value, key);
}

const legacyMigrationInFlight = new Map<AppPrefKey, Promise<AppPrefLoadResult<unknown>>>();

async function loadAppPrefWithLegacyMigrationOnce<T>(
  key: AppPrefKey,
  defaultValue: T,
  removeLegacy: (legacyKey: string) => void,
): Promise<AppPrefLoadResult<T>> {
  const stored = await loadAppPref<T>(key);
  if (stored !== undefined) return { value: stored, persisted: true };

  const legacyKey = LEGACY_STORAGE_KEY_BY_PREF[key];
  const hasLegacy = localStorage.getItem(legacyKey) !== null;
  if (!hasLegacy) return { value: defaultValue, persisted: false };

  const legacy = loadStored<T>(legacyKey, defaultValue);
  await saveAppPref(key, legacy);
  removeLegacy(legacyKey);
  return { value: legacy, persisted: true };
}

export async function loadAppPrefWithLegacyMigration<T>(
  key: AppPrefKey,
  defaultValue: T,
  removeLegacy: (legacyKey: string) => void = (legacyKey) => localStorage.removeItem(legacyKey),
): Promise<AppPrefLoadResult<T>> {
  const inFlight = legacyMigrationInFlight.get(key);
  if (inFlight) return inFlight as Promise<AppPrefLoadResult<T>>;

  const promise = loadAppPrefWithLegacyMigrationOnce(key, defaultValue, removeLegacy);
  legacyMigrationInFlight.set(key, promise as Promise<AppPrefLoadResult<unknown>>);
  try {
    return await promise;
  } finally {
    legacyMigrationInFlight.delete(key);
  }
}
