import { useCallback, useState } from 'react';
import { loadStored, saveStored } from '../services/LocalStore';

type PersistedSetOptions = {
  resolveInitial?: () => string[];
};

function readPersistedSet(key: string, fallback: string[], resolveInitial?: () => string[]): Set<string> {
  if (localStorage.getItem(key) === null && resolveInitial) {
    const initial = resolveInitial();
    writePersistedSet(key, new Set(initial));
    return new Set(initial);
  }
  return new Set(loadStored<string[]>(key, fallback));
}

function writePersistedSet(key: string, next: Set<string>): void {
  saveStored(key, Array.from(next));
}

export function usePersistedSet(key: string, options: PersistedSetOptions = {}) {
  const [value, setValue] = useState<Set<string>>(() =>
    readPersistedSet(key, [], options.resolveInitial),
  );

  const mutate = useCallback((updater: (current: Set<string>) => Set<string>) => {
    setValue((current) => {
      const next = updater(current);
      if (next === current) return current;
      writePersistedSet(key, next);
      return next;
    });
  }, [key]);

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

  const replace = useCallback((next: Set<string>) => {
    setValue((current) => {
      if (next.size === current.size && Array.from(next).every(id => current.has(id))) {
        return current;
      }
      writePersistedSet(key, next);
      return next;
    });
  }, [key]);

  const prune = useCallback((allowedIds: Set<string>) => {
    mutate((current) => {
      const next = new Set(Array.from(current).filter(id => allowedIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [mutate]);

  return {
    value,
    toggle,
    add,
    replace,
    prune,
    mutate,
  };
}
