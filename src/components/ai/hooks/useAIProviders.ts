import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AIProviderConfig, AIProviderStatus } from '../../../types';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('useAIProviders');

export type NewProviderInput = Omit<AIProviderConfig, 'id'> & { apiKey?: string };

export function useAIProviders(options: { isTauri: boolean; active: boolean }) {
  const { isTauri, active } = options;

  const [providers, setProviders] = useState<AIProviderStatus[]>([]);
  const [isEditing, setIsEditing] = useState(false);

  const refresh = useCallback(async () => {
    if (!isTauri) return;
    try {
      const list = await invoke<AIProviderStatus[]>('list_ai_providers');
      setProviders(list);
    } catch (e) {
      logger.error('Failed to load AI providers:', e);
      setProviders([]);
    }
  }, [isTauri]);

  useEffect(() => {
    if (!active) return;
    if (isTauri) {
      void refresh();
    } else {
      setProviders([]);
    }
  }, [active, isTauri, refresh]);

  const activeProvider = useMemo(
    () => providers.find((p) => p.active) ?? null,
    [providers],
  );

  const saveProvider = useCallback(
    async (config: AIProviderConfig, opts?: { activate?: boolean; apiKey?: string }) => {
      if (!isTauri) return;
      try {
        if (opts?.apiKey) {
          await invoke('set_ai_api_key', { id: config.id, key: opts.apiKey });
        }
        await invoke('save_ai_provider', {
          config,
          activate: opts?.activate ?? false,
        });
        await refresh();
      } catch (e) {
        logger.error('Failed to save provider:', e);
        throw e;
      }
    },
    [isTauri, refresh],
  );

  const deleteProvider = useCallback(
    async (id: string) => {
      if (!isTauri) return;
      try {
        await invoke('delete_ai_provider', { id });
        await refresh();
      } catch (e) {
        logger.error('Failed to delete provider:', e);
        throw e;
      }
    },
    [isTauri, refresh],
  );

  const setActive = useCallback(
    async (id: string) => {
      if (!isTauri) return;
      try {
        await invoke('set_active_ai_provider', { id });
        await refresh();
      } catch (e) {
        logger.error('Failed to set active provider:', e);
        throw e;
      }
    },
    [isTauri, refresh],
  );

  const setApiKey = useCallback(
    async (id: string, key: string) => {
      if (!isTauri) return;
      try {
        await invoke('set_ai_api_key', { id, key });
        await refresh();
      } catch (e) {
        logger.error('Failed to set API key:', e);
        throw e;
      }
    },
    [isTauri, refresh],
  );

  // Explicit AI Service connection test. Uses a saved provider and its local
  // key; never runs automatically. Resolves with a short success message from
  // the backend, or rejects with the underlying error string. Test results are
  // session-only UI state and are not persisted by this hook.
  const testProvider = useCallback(
    async (id: string): Promise<string> => {
      if (!isTauri) {
        throw new Error('Connection test requires the Tauri runtime.');
      }
      return await invoke<string>('test_ai_provider', { id });
    },
    [isTauri],
  );

  return {
    providers,
    activeProvider,
    isEditing,
    setIsEditing,
    refresh,
    saveProvider,
    deleteProvider,
    setActive,
    setApiKey,
    testProvider,
  };
}
