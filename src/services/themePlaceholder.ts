import type { Theme } from '../types';

const THEME_PLACEHOLDER_KEY = 'creader-last-theme';

export function readThemePlaceholder(): Theme | null {
  try {
    const theme = localStorage.getItem(THEME_PLACEHOLDER_KEY);
    return theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : null;
  } catch {
    return null;
  }
}

export function writeThemePlaceholder(theme: Theme): void {
  try {
    localStorage.setItem(THEME_PLACEHOLDER_KEY, theme);
  } catch {
    // Non-fatal — the next settings persist may succeed.
  }
}
