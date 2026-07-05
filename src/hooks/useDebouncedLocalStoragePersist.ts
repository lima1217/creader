import { useEffect, useRef } from 'react';
import { saveStored } from '../services/LocalStore';

export function useDebouncedLocalStoragePersist<T>(
  key: string,
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
      saveStored(key, value);
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [key, value, delayMs, skipInitial, enabled]);
}
