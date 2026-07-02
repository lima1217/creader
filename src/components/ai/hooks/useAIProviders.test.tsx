import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProviderStatus } from '../../../types';
import { useAIProviders } from './useAIProviders';

// Mock @tauri-apps/api/core's invoke so the hook never hits the real Tauri
// bridge. Hoisted so the mock factory can reference the spy.
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  // The hook only imports invoke; other consumers of this module are not
  // exercised by this test.
}));

async function settle() {
  // React 19's createRoot schedules renders on a macrotask (MessageChannel),
  // so microtask drains are not enough to flush the post-async-mutation render.
  // A short timer flush lets the snapshot reflect the committed state.
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
}

type AIProviders = ReturnType<typeof useAIProviders>;

function Snapshotter({
  isTauri,
  active,
  onSnapshot,
}: {
  isTauri: boolean;
  active: boolean;
  onSnapshot: (snapshot: AIProviders) => void;
}) {
  const providers = useAIProviders({ isTauri, active });
  onSnapshot(providers);
  return null;
}

function status(overrides: Partial<AIProviderStatus> = {}): AIProviderStatus {
  return {
    id: 'prov_1',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    active: false,
    hasKey: false,
    ...overrides,
  };
}

describe('useAIProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('does not call invoke when active is false', async () => {
    const snapshots: AIProviders[] = [];
    const container = document.createElement('div');
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <Snapshotter isTauri active={false} onSnapshot={(snap) => snapshots.push(snap)} />,
      );
    });
    await settle();

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(snapshots[snapshots.length - 1].providers).toEqual([]);

    flushSync(() => root.unmount());
  });

  it('loads providers via list_ai_providers when active', async () => {
    const list = [status({ id: 'a', active: true }), status({ id: 'b' })];
    mocks.invoke.mockResolvedValue(list);

    const container = document.createElement('div');
    const root = createRoot(container);
    let latest: AIProviders | null = null;

    flushSync(() => {
      root.render(<Snapshotter isTauri active onSnapshot={(s) => (latest = s)} />);
    });
    await settle();

    expect(mocks.invoke).toHaveBeenCalledWith('list_ai_providers');
    expect(latest!.providers).toEqual(list);
    expect(latest!.activeProvider?.id).toBe('a');

    flushSync(() => root.unmount());
  });

  it('saves a provider with an API key, activates it, and refreshes', async () => {
    mocks.invoke.mockResolvedValueOnce([]); // initial refresh
    const container = document.createElement('div');
    const root = createRoot(container);
    let latest: AIProviders | null = null;

    flushSync(() => {
      root.render(<Snapshotter isTauri active onSnapshot={(s) => (latest = s)} />);
    });
    await settle();

    const afterSave = [status({ id: 'a', active: true, hasKey: true })];
    mocks.invoke.mockResolvedValueOnce(undefined); // set_ai_api_key
    mocks.invoke.mockResolvedValueOnce(undefined); // save_ai_provider
    mocks.invoke.mockResolvedValueOnce(afterSave); // refresh list

    await latest!.saveProvider(
      { id: 'a', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      { activate: true, apiKey: 'sk-test' },
    );
    await settle();

    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'set_ai_api_key', { id: 'a', key: 'sk-test' });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, 'save_ai_provider', {
      config: { id: 'a', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      activate: true,
    });
    expect(latest!.providers).toEqual(afterSave);

    flushSync(() => root.unmount());
  });

  it('deletes a provider and refreshes', async () => {
    mocks.invoke.mockResolvedValueOnce([status({ id: 'a' })]);
    const container = document.createElement('div');
    const root = createRoot(container);
    let latest: AIProviders | null = null;

    flushSync(() => {
      root.render(<Snapshotter isTauri active onSnapshot={(s) => (latest = s)} />);
    });
    await settle();

    mocks.invoke.mockResolvedValueOnce(undefined); // delete_ai_provider
    mocks.invoke.mockResolvedValueOnce([]); // refresh

    await latest!.deleteProvider('a');
    await settle();

    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'delete_ai_provider', { id: 'a' });
    expect(latest!.providers).toEqual([]);

    flushSync(() => root.unmount());
  });

  it('sets the active provider and refreshes', async () => {
    mocks.invoke.mockResolvedValueOnce([status({ id: 'a' }), status({ id: 'b' })]);
    const container = document.createElement('div');
    const root = createRoot(container);
    let latest: AIProviders | null = null;

    flushSync(() => {
      root.render(<Snapshotter isTauri active onSnapshot={(s) => (latest = s)} />);
    });
    await settle();

    mocks.invoke.mockResolvedValueOnce(undefined); // set_active_ai_provider
    mocks.invoke.mockResolvedValueOnce([status({ id: 'a' }), status({ id: 'b', active: true })]);

    await latest!.setActive('b');
    await settle();

    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'set_active_ai_provider', { id: 'b' });
    expect(latest!.activeProvider?.id).toBe('b');

    flushSync(() => root.unmount());
  });

  it('rethrows when invoke fails so callers can surface the error', async () => {
    mocks.invoke.mockResolvedValueOnce([]); // initial refresh
    const container = document.createElement('div');
    const root = createRoot(container);
    let latest: AIProviders | null = null;

    flushSync(() => {
      root.render(<Snapshotter isTauri active onSnapshot={(s) => (latest = s)} />);
    });
    await settle();

    mocks.invoke.mockRejectedValueOnce(new Error('boom'));

    await expect(latest!.deleteProvider('a')).rejects.toThrow('boom');

    flushSync(() => root.unmount());
  });

  it('is a no-op outside Tauri even when active', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    let latest: AIProviders | null = null;

    flushSync(() => {
      root.render(<Snapshotter isTauri={false} active onSnapshot={(s) => (latest = s)} />);
    });
    await settle();

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(latest!.providers).toEqual([]);
    // Mutations resolve without invoking.
    await expect(latest!.saveProvider({ id: 'x', name: '', baseUrl: '', model: '' })).resolves.toBeUndefined();

    flushSync(() => root.unmount());
  });
});
