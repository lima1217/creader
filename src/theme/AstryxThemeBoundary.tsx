import type { ReactNode } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { useSettingsStore } from '../stores/settingsStore';
import { paperTheme } from './paperTheme';

/**
 * Applies the Astryx paper theme at the app root.
 *
 * Reads only the settings-backed theme (`settings.theme`). The provider drives
 * Astryx's `data-astryx-theme`/`data-theme` (via `mode`); the `data-theme`
 * effect in `App.tsx` (`AppBootstrap`) keeps driving native chrome + epubjs in
 * sync.
 */
export function AstryxThemeBoundary({ children }: { children: ReactNode }) {
  const theme = useSettingsStore((s) => s.settings.theme);
  return (
    <Theme theme={paperTheme} mode={theme}>
      {children}
    </Theme>
  );
}
