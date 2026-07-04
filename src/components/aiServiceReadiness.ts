import type { AIProviderStatus } from '../types';

/**
 * AI settings provider readiness helpers.
 *
 * Pure: derive the provider candidate and whether the reading conversation can
 * run from local provider metadata only. Opening settings must not call a
 * provider; connection testing remains an explicit user action.
 */

/**
 * Resolve the provider candidate to display in AI Settings: the active provider,
 * else the first configured provider as a setup hint, else null.
 */
export function resolveProviderCandidate(
  providers: AIProviderStatus[],
): AIProviderStatus | null {
  return providers.find((p) => p.active) ?? providers[0] ?? null;
}

/**
 * The only blocking setup state for chat is the absence of an active provider
 * with a stored key. Reading Memory and Quick Prompts are adjacent capabilities
 * and never drive the AI tab attention dot.
 */
export function isAiServiceReady(providers: AIProviderStatus[]): boolean {
  return providers.some((provider) => provider.active && provider.hasKey);
}
