import { useEffect, useRef } from 'react';
import { saveStored } from '../services/LocalStore';

export function useDebouncedPersist<T>(
  key: string,
  value: T,
  delayMs: number,
  options?: { skipInitial?: boolean }
): void {
  const skipInitial = options?.skipInitial === true;
  const isFirstRunRef = useRef(true);

  useEffect(() => {
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
  }, [key, value, delayMs, skipInitial]);
}

