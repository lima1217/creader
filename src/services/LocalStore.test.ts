import { describe, it, expect, beforeEach } from 'vitest';
import { loadStored, saveStored } from './LocalStore';

describe('LocalStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and loads JSON values', () => {
    saveStored('k', { a: 1 });
    expect(loadStored('k', { a: 0 })).toEqual({ a: 1 });
  });

  it('loads old envelope values', () => {
    localStorage.setItem('k', JSON.stringify({ v: 1, data: { a: 2 } }));
    expect(loadStored('k', { a: 0 })).toEqual({ a: 2 });
  });

  it('returns default when missing', () => {
    expect(loadStored('missing', 123)).toBe(123);
  });
});
