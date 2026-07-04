import { useEffect, useRef } from 'react';
import type { Book, BookFolder } from '../types';
import { STORAGE_KEYS } from '../services/LocalStore';
import { resolveInitialExpandedFolderIds } from '../domain/libraryOrganizer';
import { usePersistedSet } from './usePersistedSet';

type UseLibraryOrganizerExpandedFoldersOptions = {
  folders: BookFolder[];
  books: Book[];
  currentBook: Book | null;
  bookProgressById: Record<string, { lastReadAt?: number }>;
};

export function useLibraryOrganizerExpandedFolders(options: UseLibraryOrganizerExpandedFoldersOptions) {
  const { folders, books, currentBook, bookProgressById } = options;
  const folderIds = new Set(folders.map(folder => folder.id));
  const hasPrimedCurrentFolderRef = useRef(false);
  const hasAppliedFirstLoadRef = useRef(false);

  const { value, add, replace, prune, toggle } = usePersistedSet(STORAGE_KEYS.libraryOrganizerExpandedFolders, {
    resolveInitial: () => resolveInitialExpandedFolderIds({
      folders,
      books,
      currentBook,
      bookProgressById,
    }),
  });

  useEffect(() => {
    if (hasAppliedFirstLoadRef.current) return;
    if (folders.length === 0) return;
    if (localStorage.getItem(STORAGE_KEYS.libraryOrganizerExpandedFolders) !== null) {
      hasAppliedFirstLoadRef.current = true;
      return;
    }

    hasAppliedFirstLoadRef.current = true;
    replace(new Set(resolveInitialExpandedFolderIds({
      folders,
      books,
      currentBook,
      bookProgressById,
    })));
  }, [books, bookProgressById, currentBook, folders, replace]);

  useEffect(() => {
    const currentFolderId = currentBook?.folderId;
    if (hasPrimedCurrentFolderRef.current || !currentFolderId || !folderIds.has(currentFolderId)) return;
    hasPrimedCurrentFolderRef.current = true;
    add(currentFolderId);
  }, [add, currentBook?.folderId, folderIds]);

  useEffect(() => {
    prune(folderIds);
  }, [folderIds, prune]);

  return { expandedFolderIds: value, toggleFolder: toggle, expandFolder: add };
}
