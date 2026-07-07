import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, resolveSettings } from './initialState';
import type { Settings } from '../../types';

describe('resolveSettings', () => {
  it('silently ignores retired fontFamily and customFonts from legacy persisted JSON', () => {
    const resolved = resolveSettings({
      fontFamily: 'serif-latin',
      customFonts: [{ id: 'cf_1', label: 'Legacy', path: '/tmp/font.woff2' }],
      fontSize: 18,
    } as Partial<Settings> & { fontFamily: string; customFonts: unknown[] }, DEFAULT_SETTINGS);

    expect(resolved.fontSize).toBe(18);
    expect(resolved).not.toHaveProperty('fontFamily');
    expect(resolved).not.toHaveProperty('customFonts');
  });
});
