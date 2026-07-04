import { describe, expect, it } from 'vitest';
import type { AIProviderStatus } from '../types';
import {
  isAiServiceReady,
  resolveProviderCandidate,
} from './aiServiceReadiness';

function makeProvider(overrides: Partial<AIProviderStatus> = {}): AIProviderStatus {
  return {
    id: 'prov_1',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    active: true,
    hasKey: true,
    ...overrides,
  };
}

describe('aiServiceReadiness', () => {
  describe('resolveProviderCandidate', () => {
    it('returns the active provider first', () => {
      const inactive = makeProvider({ id: 'a', name: 'Inactive', active: false });
      const active = makeProvider({ id: 'b', name: 'Active', active: true });
      expect(resolveProviderCandidate([inactive, active])).toBe(active);
    });

    it('falls back to the first configured provider', () => {
      const first = makeProvider({ id: 'a', active: false });
      const second = makeProvider({ id: 'b', active: false });
      expect(resolveProviderCandidate([first, second])).toBe(first);
    });

    it('returns null when no provider exists', () => {
      expect(resolveProviderCandidate([])).toBeNull();
    });
  });

  describe('isAiServiceReady', () => {
    it('is true only when an active provider has a key', () => {
      expect(isAiServiceReady([makeProvider({ active: true, hasKey: true })])).toBe(true);
    });

    it('is false when no provider is configured', () => {
      expect(isAiServiceReady([])).toBe(false);
    });

    it('is false when providers exist but none is active', () => {
      expect(isAiServiceReady([makeProvider({ active: false, hasKey: true })])).toBe(false);
    });

    it('is false when the active provider has no key', () => {
      expect(isAiServiceReady([makeProvider({ active: true, hasKey: false })])).toBe(false);
    });
  });
});
