import { useEffect, useRef } from 'react';
import type { AppPrefKey } from '../services/DexieDb';
import { saveAppPref } from '../services/AppPrefsStore';

export function useDebouncedDexiePersist<T>(
  key: AppPrefKey,
  value: T,
  delayMs: number,
  options?: { skipInitial?: boolean; enabled?: boolean },
): void {
  const skipInitial = options?.skipInitial === true;
  const enabled = options?.enabled !== false;
  const isFirstRunRef = useRef(true);

  useEffect(() => {
    if (!enabled) return;

    if (isFirstRunRef.current) {
      isFirstRunRef.current = false;
      if (skipInitial) return;
    }

    const timer = window.setTimeout(() => {
      void saveAppPref(key, value).catch(() => {
        // Persistence failures are non-fatal; the next debounced write may succeed.
      });
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [key, value, delayMs, skipInitial, enabled]);
}
