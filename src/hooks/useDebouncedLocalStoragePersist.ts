import { saveStored } from '../services/LocalStore';
import { useDebouncedPersist } from './useDebouncedPersist';

export function useDebouncedLocalStoragePersist<T>(
  key: string,
  value: T,
  delayMs: number,
  options?: { skipInitial?: boolean; enabled?: boolean },
): void {
  useDebouncedPersist(key, value, delayMs, saveStored, options);
}
