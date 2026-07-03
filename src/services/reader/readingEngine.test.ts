import { describe, expect, it } from 'vitest';
import { epubjsEngineAdapter } from './epubjsEngine';
import { foliateEngineAdapter } from './foliateEngine';

describe('reading engine adapters', () => {
  it('keeps epubjs and foliate behind the same CReader-facing capabilities', () => {
    const adapters = [foliateEngineAdapter, epubjsEngineAdapter];

    for (const adapter of adapters) {
      expect(adapter.supports.navigation).toBe(true);
      expect(adapter.supports.selection).toBe(true);
      expect(adapter.supports.progress).toBe(true);
      expect(adapter.supports.searchLocatorNavigation).toBe(true);
      expect(adapter.supports.theme).toBe(true);
      expect(adapter.supports.cfi).toBe('epub-cfi');
    }
  });

  it('uses foliate as the preferred engine while keeping epubjs available as fallback', () => {
    expect(foliateEngineAdapter.name).toBe('foliate');
    expect(epubjsEngineAdapter.name).toBe('epubjs');
  });
});
