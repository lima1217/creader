import { shouldSkipPrefHydrate } from '../services/appPrefsHydration';

let cachedExpandedFolderIds: string[] | null = null;
let cachePersisted = false;

export function setExpandedFolderIdsCache(ids: string[], persisted: boolean): void {
  cachedExpandedFolderIds = ids;
  cachePersisted = persisted;
}

export function hydrateExpandedFolderIds(ids: string[], persisted: boolean): void {
  if (shouldSkipPrefHydrate('expandedFolders')) return;
  setExpandedFolderIdsCache(ids, persisted);
}

export function getCachedExpandedFolderIds(): { ids: string[]; persisted: boolean } | null {
  if (cachedExpandedFolderIds === null) return null;
  return { ids: cachedExpandedFolderIds, persisted: cachePersisted };
}

export function resetExpandedFolderIdsCache(): void {
  cachedExpandedFolderIds = null;
  cachePersisted = false;
}
