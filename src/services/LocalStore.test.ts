import { describe, it, expect, beforeEach } from 'vitest';
import { loadStored, saveStored } from './LocalStore';

describe('LocalStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and loads envelope values', () => {
    saveStored('k', { a: 1 });
    expect(loadStored('k', { a: 0 })).toEqual({ a: 1 });
  });

  it('loads legacy non-envelope values', () => {
    localStorage.setItem('k', JSON.stringify({ a: 2 }));
    expect(loadStored('k', { a: 0 })).toEqual({ a: 2 });
  });

  it('returns default when missing', () => {
    expect(loadStored('missing', 123)).toBe(123);
  });
});
