import type { ReactNode } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { useSettings } from '../stores/AppContext';
import { paperTheme } from './paperTheme';
import { AstryxSmokeTest } from './AstryxSmokeTest';

/**
 * Applies the Astryx paper theme at the app root.
 *
 * Reads only the settings-backed theme (`settings.theme`), intentionally NOT
 * `useUI`/`useAI`, so this stays orthogonal to issue #12 (Zustand transient UI
 * state) and the two can land in either order. The provider drives Astryx's
 * `data-astryx-theme`/`data-theme` (via `mode`); the existing `data-theme`
 * effect in `AppContext.tsx` keeps driving native chrome + epubjs in sync.
 */
export function AstryxThemeBoundary({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  return (
    <Theme theme={paperTheme} mode={settings.theme}>
      <AstryxSmokeTest />
      {children}
    </Theme>
  );
}
