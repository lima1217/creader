import { useEffect, useState } from 'react';
import { canPersistAppPrefs, subscribeAppPrefsHydration } from '../services/appPrefsHydration';

export function useCanPersistAppPrefs(): boolean {
  const [canPersist, setCanPersist] = useState(canPersistAppPrefs());

  useEffect(() => subscribeAppPrefsHydration(() => {
    setCanPersist(canPersistAppPrefs());
  }), []);

  return canPersist;
}
