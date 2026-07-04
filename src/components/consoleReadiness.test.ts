import { describe, expect, it } from 'vitest';
import type { AIProviderStatus } from '../types';
import {
  CONSOLE_AREAS,
  computeAreaStatuses,
  computeOverallReadiness,
  computeSideNavBadges,
  type ConsoleReadinessInput,
} from './consoleReadiness';

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

describe('consoleReadiness', () => {
  describe('computeAreaStatuses', () => {
    it('marks AI Service missing when no provider is configured', () => {
      const statuses = computeAreaStatuses({
        providers: [],
        readingMemoryPath: '/mem',
        readingMemoryAutoIngest: true,
        aiContextWindow: 20,
        aiAutoSummarize: true,
        quickPromptCount: 4,
      });
      const ai = statuses.find((s) => s.area === 'ai-service');
      expect(ai?.readiness).toBe('missing');
    });

    it('marks AI Service missing when the active provider has no key', () => {
      const statuses = computeAreaStatuses({
        providers: [makeProvider({ hasKey: false })],
        readingMemoryPath: '/mem',
        readingMemoryAutoIngest: true,
        aiContextWindow: 20,
        aiAutoSummarize: true,
        quickPromptCount: 4,
      });
      const ai = statuses.find((s) => s.area === 'ai-service');
      expect(ai?.readiness).toBe('missing');
    });

    it('marks AI Service ready when an active provider has a key', () => {
      const statuses = computeAreaStatuses({
        providers: [makeProvider({ hasKey: true })],
        readingMemoryPath: '/mem',
        readingMemoryAutoIngest: true,
        aiContextWindow: 20,
        aiAutoSummarize: true,
        quickPromptCount: 4,
      });
      const ai = statuses.find((s) => s.area === 'ai-service');
      expect(ai?.readiness).toBe('ready');
    });

    it('marks AI Service degraded when providers exist but none is active', () => {
      const statuses = computeAreaStatuses({
        providers: [
          makeProvider({ id: 'a', active: false, hasKey: true }),
          makeProvider({ id: 'b', active: false, hasKey: true }),
        ],
        readingMemoryPath: '/mem',
        readingMemoryAutoIngest: true,
        aiContextWindow: 20,
        aiAutoSummarize: true,
        quickPromptCount: 4,
      });
      const ai = statuses.find((s) => s.area === 'ai-service');
      // Providers configured + keyed, but none enabled → conversation can run
      // after the reader enables one, so degraded (not missing).
      expect(ai?.readiness).toBe('degraded');
    });

    it('marks AI Service missing when the active provider has no key', () => {
      const statuses = computeAreaStatuses({
        providers: [makeProvider({ active: true, hasKey: false })],
        readingMemoryPath: '/mem',
        readingMemoryAutoIngest: true,
        aiContextWindow: 20,
        aiAutoSummarize: true,
        quickPromptCount: 4,
      });
      const ai = statuses.find((s) => s.area === 'ai-service');
      // Active provider without a key cannot serve chat → missing setup.
      expect(ai?.readiness).toBe('missing');
    });

    it('marks Reading Memory missing when no repository is chosen', () => {
      const statuses = computeAreaStatuses({
        providers: [makeProvider()],
        readingMemoryPath: undefined,
        readingMemoryAutoIngest: false,
        aiContextWindow: 20,
        aiAutoSummarize: true,
        quickPromptCount: 4,
      });
      const mem = statuses.find((s) => s.area === 'reading-memory');
      expect(mem?.readiness).toBe('missing');
    });

    it('marks Reading Memory degraded when a path is set but auto-ingest is off', () => {
      const statuses = computeAreaStatuses({
        providers: [makeProvider()],
        readingMemoryPath: '/mem',
        readingMemoryAutoIngest: false,
        aiContextWindow: 20,
        aiAutoSummarize: true,
        quickPromptCount: 4,
      });
      const mem = statuses.find((s) => s.area === 'reading-memory');
      expect(mem?.readiness).toBe('degraded');
    });

    it('marks Reading Memory ready when a path is set and auto-ingest is on', () => {
      const statuses = computeAreaStatuses({
        providers: [makeProvider()],
        readingMemoryPath: '/mem',
        readingMemoryAutoIngest: true,
        aiContextWindow: 20,
        aiAutoSummarize: true,
        quickPromptCount: 4,
      });
      const mem = statuses.find((s) => s.area === 'reading-memory');
      expect(mem?.readiness).toBe('ready');
    });

    it('always marks Conversation Behavior ready (local prefs only)', () => {
      const statuses = computeAreaStatuses({
        providers: [makeProvider()],
        readingMemoryPath: '/mem',
        readingMemoryAutoIngest: true,
        aiContextWindow: 5,
        aiAutoSummarize: false,
        quickPromptCount: 4,
      });
      const conv = statuses.find((s) => s.area === 'conversation');
      expect(conv?.readiness).toBe('ready');
    });

    it('marks Quick Prompts degraded when the list is empty', () => {
      const statuses = computeAreaStatuses({
        providers: [makeProvider()],
        readingMemoryPath: '/mem',
        readingMemoryAutoIngest: true,
        aiContextWindow: 20,
        aiAutoSummarize: true,
        quickPromptCount: 0,
      });
      const qp = statuses.find((s) => s.area === 'quick-prompts');
      expect(qp?.readiness).toBe('degraded');
    });

    it('marks Quick Prompts ready when at least one prompt exists', () => {
      const statuses = computeAreaStatuses({
        providers: [makeProvider()],
        readingMemoryPath: '/mem',
        readingMemoryAutoIngest: true,
        aiContextWindow: 20,
        aiAutoSummarize: true,
        quickPromptCount: 3,
      });
      const qp = statuses.find((s) => s.area === 'quick-prompts');
      expect(qp?.readiness).toBe('ready');
    });

    it('emits a status row for every console area except overview', () => {
      const statuses = computeAreaStatuses({
        providers: [makeProvider()],
        readingMemoryPath: '/mem',
        readingMemoryAutoIngest: true,
        aiContextWindow: 20,
        aiAutoSummarize: true,
        quickPromptCount: 4,
      });
      const ids = statuses.map((s) => s.area);
      expect(ids).toEqual(['ai-service', 'conversation', 'reading-memory', 'quick-prompts']);
    });

    it('never returns nullish title/detail for any row', () => {
      const statuses = computeAreaStatuses({
        providers: [],
        readingMemoryPath: undefined,
        readingMemoryAutoIngest: false,
        aiContextWindow: 5,
        aiAutoSummarize: false,
        quickPromptCount: 0,
      });
      for (const status of statuses) {
        expect(status.title.trim().length).toBeGreaterThan(0);
        expect(status.detail.trim().length).toBeGreaterThan(0);
        expect(status.actionLabel.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe('computeOverallReadiness', () => {
    const baseInput: ConsoleReadinessInput = {
      providers: [makeProvider()],
      readingMemoryPath: '/mem',
      readingMemoryAutoIngest: true,
      aiContextWindow: 20,
      aiAutoSummarize: true,
      quickPromptCount: 4,
    };

    it('is ready when every area is ready', () => {
      expect(computeOverallReadiness(computeAreaStatuses(baseInput))).toBe('ready');
    });

    it('is missing when AI Service is missing (conversation cannot run)', () => {
      expect(
        computeOverallReadiness(
          computeAreaStatuses({ ...baseInput, providers: [] }),
        ),
      ).toBe('missing');
    });

    it('is degraded (not missing) when AI Service is ready but Reading Memory has no repository', () => {
      // The conversation can still run, so a missing adjacent capability
      // (Reading Memory repository) downgrades the console to degraded.
      expect(
        computeOverallReadiness(
          computeAreaStatuses({ ...baseInput, readingMemoryPath: undefined }),
        ),
      ).toBe('degraded');
    });

    it('is degraded when AI Service is ready but an adjacent capability is off', () => {
      expect(
        computeOverallReadiness(
          computeAreaStatuses({ ...baseInput, readingMemoryAutoIngest: false }),
        ),
      ).toBe('degraded');
    });

    it('is degraded when quick prompts are empty even if everything else is ready', () => {
      expect(
        computeOverallReadiness(
          computeAreaStatuses({ ...baseInput, quickPromptCount: 0 }),
        ),
      ).toBe('degraded');
    });
  });

  describe('computeSideNavBadges', () => {
    const baseInput: ConsoleReadinessInput = {
      providers: [makeProvider()],
      readingMemoryPath: '/mem',
      readingMemoryAutoIngest: true,
      aiContextWindow: 20,
      aiAutoSummarize: true,
      quickPromptCount: 4,
    };

    it('returns no badges when everything is ready', () => {
      expect(computeSideNavBadges(computeAreaStatuses(baseInput))).toEqual([]);
    });

    it('badges AI Service when the provider/key is missing', () => {
      const badges = computeSideNavBadges(
        computeAreaStatuses({ ...baseInput, providers: [] }),
      );
      expect(badges.map((b) => b.area)).toContain('ai-service');
    });

    it('does not badge Reading Memory when auto-ingest is off but a path exists', () => {
      // Degraded overall, but not a side-nav attention state.
      const badges = computeSideNavBadges(
        computeAreaStatuses({ ...baseInput, readingMemoryAutoIngest: false }),
      );
      expect(badges.map((b) => b.area)).not.toContain('reading-memory');
    });

    it('badges Reading Memory when no repository is configured', () => {
      const badges = computeSideNavBadges(
        computeAreaStatuses({ ...baseInput, readingMemoryPath: undefined }),
      );
      expect(badges.map((b) => b.area)).toContain('reading-memory');
    });

    it('badges Quick Prompts when the list is empty', () => {
      const badges = computeSideNavBadges(
        computeAreaStatuses({ ...baseInput, quickPromptCount: 0 }),
      );
      expect(badges.map((b) => b.area)).toContain('quick-prompts');
    });
  });

  describe('CONSOLE_AREAS', () => {
    it('lists the five console areas with overview first', () => {
      const ids = CONSOLE_AREAS.map((a) => a.id);
      expect(ids).toEqual([
        'overview',
        'ai-service',
        'conversation',
        'reading-memory',
        'quick-prompts',
      ]);
    });

    it('every area has a non-empty label', () => {
      for (const area of CONSOLE_AREAS) {
        expect(area.label.trim().length).toBeGreaterThan(0);
      }
    });
  });
});
