export type AppPrefDomain =
  | 'settings'
  | 'library'
  | 'progress'
  | 'quickActions'
  | 'expandedFolders';

type HydrationState = 'pending' | 'done' | 'failed';

let hydrationState: HydrationState = 'pending';
const userEditedBeforeHydration: Record<AppPrefDomain, boolean> = {
  settings: false,
  library: false,
  progress: false,
  quickActions: false,
  expandedFolders: false,
};

const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function isAppPrefsHydrated(): boolean {
  return hydrationState === 'done';
}

export function hasAppPrefsHydrationSettled(): boolean {
  return hydrationState !== 'pending';
}

export function canPersistAppPrefs(): boolean {
  return hydrationState === 'done';
}

export function markAppPrefsHydrated(): void {
  if (hydrationState === 'done') return;
  hydrationState = 'done';
  notifyListeners();
}

export function markAppPrefsHydrationFailed(): void {
  hydrationState = 'failed';
  notifyListeners();
}

export function markUserEditedPref(domain: AppPrefDomain): void {
  if (hydrationState === 'pending') {
    userEditedBeforeHydration[domain] = true;
  }
}

export function shouldSkipPrefHydrate(domain: AppPrefDomain): boolean {
  return userEditedBeforeHydration[domain];
}

export function wasPrefEditedBeforeHydration(domain: AppPrefDomain): boolean {
  return userEditedBeforeHydration[domain];
}

export function resetAppPrefsHydrationForTests(): void {
  hydrationState = 'pending';
  userEditedBeforeHydration.settings = false;
  userEditedBeforeHydration.library = false;
  userEditedBeforeHydration.progress = false;
  userEditedBeforeHydration.quickActions = false;
  userEditedBeforeHydration.expandedFolders = false;
}

export function subscribeAppPrefsHydration(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
