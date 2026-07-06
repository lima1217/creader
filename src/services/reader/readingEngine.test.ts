import { describe, expect, it } from 'vitest';
import { foliateEngineAdapter } from './foliateEngine';

describe('reading engine adapters', () => {
  it('exposes foliate as the only CReader reading engine', () => {
    expect(foliateEngineAdapter.name).toBe('foliate');
    expect(foliateEngineAdapter.supports.navigation).toBe(true);
    expect(foliateEngineAdapter.supports.selection).toBe(true);
    expect(foliateEngineAdapter.supports.progress).toBe(true);
    expect(foliateEngineAdapter.supports.theme).toBe(true);
    expect(foliateEngineAdapter.supports.layout).toBe(true);
    expect(foliateEngineAdapter.supports.cfi).toBe('epub-cfi');
  });
});
