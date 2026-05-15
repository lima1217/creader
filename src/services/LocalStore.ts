export const STORAGE_KEYS = {
  settings: 'creader-settings',
  library: 'creader-library',
  chat: 'creader-chat',
  quickActions: 'creader-quick-actions',
  progress: 'creader-progress',
  syncMeta: 'creader-sync-meta',
  deviceId: 'creader-device-id',
} as const;

const STORAGE_VERSION = 1;

type Envelope<T> = {
  v: number;
  data: T;
};

export function loadStored<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return defaultValue;

    const parsed = JSON.parse(stored) as unknown;
    if (parsed && typeof parsed === 'object' && 'v' in (parsed as any) && 'data' in (parsed as any)) {
      const env = parsed as Envelope<T>;
      if (typeof env.v === 'number') return env.data;
    }

    return parsed as T;
  } catch {
    return defaultValue;
  }
}

export function saveStored<T>(key: string, value: T): void {
  try {
    const env: Envelope<T> = { v: STORAGE_VERSION, data: value };
    localStorage.setItem(key, JSON.stringify(env));
  } catch {
  }
}
