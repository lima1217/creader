import type { BookFolder } from '../types';

export function normalizeFolderName(name: string): string {
  return name.trim();
}

export function isDuplicateFolderName(
  name: string,
  folders: BookFolder[],
  excludeId?: string,
): boolean {
  const normalized = normalizeFolderName(name).toLocaleLowerCase();
  if (!normalized) return false;
  return folders.some(folder =>
    folder.id !== excludeId
    && folder.name.toLocaleLowerCase() === normalized,
  );
}

/** Returns trimmed name when valid; otherwise null. */
export function validateFolderName(
  name: string,
  folders: BookFolder[],
  excludeId?: string,
): string | null {
  const trimmed = normalizeFolderName(name);
  if (!trimmed || isDuplicateFolderName(trimmed, folders, excludeId)) {
    return null;
  }
  return trimmed;
}

export function folderExists(folderId: string, folders: BookFolder[]): boolean {
  return folders.some(folder => folder.id === folderId);
}
