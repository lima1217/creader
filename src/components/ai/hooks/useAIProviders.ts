import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AIProviderInfo } from '../types';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('useAIProviders');

const fallbackProviders: AIProviderInfo[] = [
  { id: 'hermes', name: 'Hermes', model: 'Hermes Agent', available: false },
  { id: 'claude', name: 'Claude', model: 'sonnet', available: false },
  { id: 'opencode', name: 'OpenCode', model: 'default', available: false },
  { id: 'codex', name: 'Codex', model: 'default', available: false },
];

export function useAIProviders(options: { isTauri: boolean; active: boolean }) {
  const { isTauri, active } = options;

  const [providers, setProviders] = useState<AIProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('claude');
  const [showProviderDropdown, setShowProviderDropdown] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('opus');
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  const handleProviderChange = useCallback(
    async (providerId: string) => {
      setSelectedProvider(providerId);
      setShowProviderDropdown(false);
      if (!isTauri) return;
      try {
        await invoke('set_ai_provider', { provider: providerId });
      } catch (e) {
        logger.error('Failed to set provider:', e);
      }
    },
    [isTauri]
  );

  const loadSavedProvider = useCallback(async () => {
    if (!isTauri) return;
    try {
      const saved = await invoke<string | null>('get_ai_provider');
      if (saved) setSelectedProvider(saved);
    } catch (e) {
      logger.error('Failed to load saved provider:', e);
    }
  }, [isTauri]);

  const checkAIAvailability = useCallback(async () => {
    if (!isTauri) return;
    try {
      const available = await invoke<AIProviderInfo[]>('check_ai_availability');
      setProviders(available);
      const currentAvailable = available.find((p) => p.id === selectedProvider && p.available);
      if (!currentAvailable) {
        const firstAvailable = available.find((p) => p.available);
        if (firstAvailable) {
          void handleProviderChange(firstAvailable.id);
        }
      }
    } catch (e) {
      logger.error('Failed to check AI availability:', e);
      setProviders([]);
    }
  }, [handleProviderChange, isTauri, selectedProvider]);

  const refreshAIAvailability = useCallback(async () => {
    if (!isTauri) return;
    try {
      const available = await invoke<AIProviderInfo[]>('refresh_ai_availability');
      setProviders(available);
      const firstAvailable = available.find((p) => p.available);
      if (firstAvailable) {
        void handleProviderChange(firstAvailable.id);
      }
    } catch (e) {
      logger.error('Failed to refresh AI availability:', e);
    }
  }, [handleProviderChange, isTauri]);

  useEffect(() => {
    if (!active) return;
    if (isTauri) {
      void checkAIAvailability();
      void loadSavedProvider();
    } else {
      setProviders(fallbackProviders);
    }
  }, [active, checkAIAvailability, isTauri, loadSavedProvider]);

  const currentProvider = useMemo(() => {
    return (
      providers.find((p) => p.id === selectedProvider) || {
        id: selectedProvider,
        name: selectedProvider,
        model: '',
        available: false,
      }
    );
  }, [providers, selectedProvider]);

  return {
    providers,
    selectedProvider,
    setSelectedProvider,
    showProviderDropdown,
    setShowProviderDropdown,
    selectedModel,
    setSelectedModel,
    showModelDropdown,
    setShowModelDropdown,
    currentProvider,
    handleProviderChange,
    checkAIAvailability,
    refreshAIAvailability,
  };
}
