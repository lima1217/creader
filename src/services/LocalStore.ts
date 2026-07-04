export const STORAGE_KEYS = {
  settings: 'creader-settings',
  library: 'creader-library',
  chat: 'creader-chat',
  quickActions: 'creader-quick-actions',
  progress: 'creader-progress',
  libraryOrganizerExpandedFolders: 'creader-library-organizer-expanded-folders',
  syncMeta: 'creader-sync-meta',
  deviceId: 'creader-device-id',
} as const;

export function loadStored<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return defaultValue;
    const parsed = JSON.parse(stored) as any;
    return parsed && typeof parsed === 'object' && typeof parsed.v === 'number' && 'data' in parsed
      ? parsed.data as T
      : parsed as T;
  } catch {
    return defaultValue;
  }
}

export function saveStored<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}
