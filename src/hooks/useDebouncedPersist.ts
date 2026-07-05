import { useEffect, useRef } from 'react';

/**
 * Debounced write-through effect shared by the Dexie and localStorage persist
 * hooks. `persist` is read through a ref so a changing callback identity never
 * resets the debounce timer — only key/value/delay/skipInitial/enabled do.
 */
export function useDebouncedPersist<K, T>(
  key: K,
  value: T,
  delayMs: number,
  persist: (key: K, value: T) => void,
  options?: { skipInitial?: boolean; enabled?: boolean },
): void {
  const skipInitial = options?.skipInitial === true;
  const enabled = options?.enabled !== false;
  const isFirstRunRef = useRef(true);
  const persistRef = useRef(persist);
  persistRef.current = persist;

  useEffect(() => {
    if (!enabled) return;

    if (isFirstRunRef.current) {
      isFirstRunRef.current = false;
      if (skipInitial) return;
    }

    const timer = window.setTimeout(() => {
      persistRef.current(key, value);
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [key, value, delayMs, skipInitial, enabled]);
}
