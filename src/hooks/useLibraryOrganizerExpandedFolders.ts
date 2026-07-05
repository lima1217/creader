import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book, BookFolder } from '../types';
import { APP_PREF_KEYS } from '../services/DexieDb';
import { saveAppPref } from '../services/AppPrefsStore';
import { saveStored, STORAGE_KEYS } from '../services/LocalStore';
import { isIndexedDbAvailable } from '../services/indexedDbAvailability';
import { resolveInitialExpandedFolderIds } from '../domain/libraryOrganizer';
import {
  hasAppPrefsHydrationSettled,
  markUserEditedPref,
  subscribeAppPrefsHydration,
} from '../services/appPrefsHydration';
import {
  getCachedExpandedFolderIds,
  setExpandedFolderIdsCache,
} from './expandedFoldersStorage';

type UseLibraryOrganizerExpandedFoldersOptions = {
  folders: BookFolder[];
  books: Book[];
  currentBook: Book | null;
  bookProgressById: Record<string, { lastReadAt?: number }>;
};

function persistExpandedFolderIds(ids: string[]): void {
  markUserEditedPref('expandedFolders');
  setExpandedFolderIdsCache(ids, true);
  if (isIndexedDbAvailable()) {
    void saveAppPref(APP_PREF_KEYS.libraryOrganizerExpandedFolders, ids).catch(() => {
      // Persistence failures are non-fatal; the next write may succeed.
    });
  } else {
    saveStored(STORAGE_KEYS.libraryOrganizerExpandedFolders, ids);
  }
}

export function useLibraryOrganizerExpandedFolders(options: UseLibraryOrganizerExpandedFoldersOptions) {
  const { folders, books, currentBook, bookProgressById } = options;
  const folderIds = new Set(folders.map(folder => folder.id));
  const hasPrimedCurrentFolderRef = useRef(false);
  const hasAppliedFirstLoadRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());

  const replace = useCallback((next: Set<string>) => {
    setExpandedFolderIds((current) => {
      if (next.size === current.size && Array.from(next).every(id => current.has(id))) {
        return current;
      }
      persistExpandedFolderIds(Array.from(next));
      return next;
    });
  }, []);

  const mutate = useCallback((updater: (current: Set<string>) => Set<string>) => {
    setExpandedFolderIds((current) => {
      const next = updater(current);
      if (next === current) return current;
      persistExpandedFolderIds(Array.from(next));
      return next;
    });
  }, []);

  const toggle = useCallback((id: string) => {
    mutate((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, [mutate]);

  const add = useCallback((id: string) => {
    mutate((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, [mutate]);

  const prune = useCallback((allowedIds: Set<string>) => {
    mutate((current) => {
      const next = new Set(Array.from(current).filter(id => allowedIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [mutate]);

  useEffect(() => {
    const applyIfReady = () => {
      const cached = getCachedExpandedFolderIds();
      if (cached) {
        setExpandedFolderIds(new Set(cached.ids));
        if (cached.persisted) hasAppliedFirstLoadRef.current = true;
        setHydrated(true);
        return;
      }

      if (hasAppPrefsHydrationSettled()) {
        setHydrated(true);
      }
    };

    applyIfReady();
    return subscribeAppPrefsHydration(applyIfReady);
  }, []);

  useEffect(() => {
    if (!hydrated || hasAppliedFirstLoadRef.current) return;
    if (folders.length === 0) return;

    hasAppliedFirstLoadRef.current = true;
    replace(new Set(resolveInitialExpandedFolderIds({
      folders,
      books,
      currentBook,
      bookProgressById,
    })));
  }, [books, bookProgressById, currentBook, folders, hydrated, replace]);

  useEffect(() => {
    const currentFolderId = currentBook?.folderId;
    if (hasPrimedCurrentFolderRef.current || !currentFolderId || !folderIds.has(currentFolderId)) return;
    hasPrimedCurrentFolderRef.current = true;
    add(currentFolderId);
  }, [add, currentBook?.folderId, folderIds]);

  useEffect(() => {
    prune(folderIds);
  }, [folderIds, prune]);

  return { expandedFolderIds, toggleFolder: toggle, expandFolder: add };
}

export { resetExpandedFolderIdsCache } from './expandedFoldersStorage';
