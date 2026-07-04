import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { useSettingsStore } from '../stores/settingsStore';

import { installDialogElementStub, installResizeObserverStub } from './testUtils';

/**
 * SettingsPanel contract tests — issue #50.
 *
 * Locks the AI Reading Console shell: it opens on the actionable Overview
 * first, derives readiness from local configuration only, never triggers a
 * provider network request on open, offers working side-nav navigation across
 * the five console areas, and surfaces a status row for each non-overview area.
 *
 * Mocking follows the Phase 1 contract-mock precedent (see AIPanel.test.tsx):
 * heavy Tauri plugins and the provider hook are mocked so the shell can be
 * driven synchronously without a backend.
 */

// --- vi.hoisted: provider + invoke capture --------------------------------

const { invokeCalls, resetInvokeCapture, setProviderList, getProviders } = vi.hoisted(() => {
  const calls: Array<{ cmd: string; args: unknown }> = [];
  let providers: Array<{
    id: string;
    name: string;
    baseUrl: string;
    model: string;
    active: boolean;
    hasKey: boolean;
  }> = [];
  return {
    invokeCalls: calls,
    resetInvokeCapture: () => {
      calls.length = 0;
    },
    setProviderList: (next: typeof providers) => {
      providers = next;
    },
    getProviders: () => providers,
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    invokeCalls.push({ cmd, args });
    if (cmd === 'list_ai_providers') return getProviders();
    return undefined;
  },
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: async () => null,
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: async () => undefined,
}));

vi.mock('../utils/tauri', () => ({ isTauriRuntime: () => true }));
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
}));

import { SettingsPanel } from './SettingsPanel';

// --- Fixture helpers ------------------------------------------------------

const DEFAULT_PROVIDERS = [
  {
    id: 'prov_1',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    active: true,
    hasKey: true,
  },
];

function resetSettings() {
  useSettingsStore.setState({
    settings: {
      theme: 'light',
      fontSize: 16,
      fontFamily: 'Georgia',
      lineHeight: 1.6,
      readingMemoryPath: '/mem/root',
      readingMemoryAutoIngest: true,
      aiTextSize: 14,
      aiContextWindow: 20,
      aiAutoSummarize: true,
    },
  });
}

const roots: Root[] = [];

function mount(node: React.ReactNode): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  flushSync(() => {
    root.render(node as React.ReactElement);
  });
  return container;
}

function unmountAll() {
  while (roots.length) {
    const r = roots.pop()!;
    try {
      flushSync(() => r.unmount());
    } catch {
      /* already unmounted */
    }
  }
  document.body.innerHTML = '';
}

async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  flushSync(() => {});
}

function activeAreaLabel(container: HTMLElement): string | null {
  const active = container.querySelector('.console-nav-item.active .console-nav-label');
  return active?.textContent?.trim() ?? null;
}

function statusRowTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.console-status-row-title')).map((el) =>
    el.textContent?.trim() ?? '',
  );
}

describe('SettingsPanel — AI Reading Console shell (#50)', () => {
  beforeEach(() => {
    installDialogElementStub();
    installResizeObserverStub();
    localStorage.clear();
    resetSettings();
    resetInvokeCapture();
    setProviderList(DEFAULT_PROVIDERS);
  });

  afterEach(() => {
    unmountAll();
  });

  it('opens the Overview first and lists the five console areas in the side nav', async () => {
    const container = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();

    const navLabels = Array.from(container.querySelectorAll('.console-nav-label')).map((el) =>
      el.textContent?.trim() ?? '',
    );
    expect(navLabels).toEqual(['概览', 'AI 服务', '对话行为', '阅读记忆', '快捷提示词']);
    // Overview is the active area on open.
    expect(activeAreaLabel(container)).toBe('概览');
    // Overview content (hero) is present.
    expect(container.querySelector('.console-hero')).not.toBeNull();
  });

  it('shows a status row for each non-overview area on Overview', async () => {
    const container = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();

    // Four status rows: AI Service, Conversation Behavior, Reading Memory, Quick Prompts.
    expect(statusRowTitles(container).length).toBe(4);
    // Each row has an actionable button that jumps to its area.
    const rowButtons = container.querySelectorAll('.console-status-row Button, .console-status-row button');
    expect(rowButtons.length).toBeGreaterThanOrEqual(4);
  });

  it('marks the overall readiness "ready" when everything is configured', async () => {
    const container = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();

    const chip = container.querySelector('.console-readiness-chip');
    // Default fixture: provider with key, memory path, auto-ingest on, prompts present.
    expect(chip?.getAttribute('data-readiness')).toBe('ready');
  });

  it('downgrades to missing when the AI Service has no provider', async () => {
    setProviderList([]);
    const container = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();

    const chip = container.querySelector('.console-readiness-chip');
    expect(chip?.getAttribute('data-readiness')).toBe('missing');
    // Side nav shows an attention badge on the AI Service item.
    const aiItem = Array.from(container.querySelectorAll('.console-nav-item')).find((el) =>
      (el.textContent ?? '').includes('AI 服务'),
    );
    expect(aiItem?.querySelector('.astryx-badge')).not.toBeNull();
  });

  it('shows a side-nav badge on Reading Memory when no repository is chosen', async () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        readingMemoryPath: undefined,
        readingMemoryAutoIngest: false,
      },
    });
    const container = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();

    const memItem = Array.from(container.querySelectorAll('.console-nav-item')).find((el) =>
      (el.textContent ?? '').includes('阅读记忆'),
    );
    expect(memItem?.querySelector('.astryx-badge')).not.toBeNull();
  });

  it('shows a side-nav badge on Quick Prompts when the prompt list is empty', async () => {
    localStorage.setItem('creader-quick-actions', JSON.stringify([]));
    const container = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();

    const qpItem = Array.from(container.querySelectorAll('.console-nav-item')).find((el) =>
      (el.textContent ?? '').includes('快捷提示词'),
    );
    expect(qpItem?.querySelector('.astryx-badge')).not.toBeNull();
  });

  it('navigates to AI Service from the Overview CTA', async () => {
    const container = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();

    // The AI Service status row is the first row and ends in an action button.
    const rows = container.querySelectorAll('.console-status-row');
    const aiRow = rows[0];
    expect(aiRow?.textContent ?? '').toContain('DeepSeek');
    const aiRowButton = aiRow.querySelector('button');
    expect(aiRowButton).toBeTruthy();
    aiRowButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    expect(activeAreaLabel(container)).toBe('AI 服务');
    // The AI Service summary surface is rendered, not the editor.
    expect(container.querySelector('.settings-provider-summary')).not.toBeNull();
  });

  it('navigates between areas via the side nav', async () => {
    const container = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();

    const convItem = Array.from(container.querySelectorAll('.console-nav-item')).find((el) =>
      (el.textContent ?? '').includes('对话行为'),
    );
    convItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    expect(activeAreaLabel(container)).toBe('对话行为');
    // Conversation Behavior renders the context-window segmented control.
    expect(container.querySelector('#settings-context-window')).not.toBeNull();
  });

  it('does not trigger a provider request beyond the local list when opened', async () => {
    // list_ai_providers is a local read, not a network call to the provider.
    // Opening the console must not invoke chat, connection-test, or stream commands.
    mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();

    const cmds = invokeCalls.map((c) => c.cmd);
    const forbidden = cmds.filter((cmd) =>
      /chat|stream|connect|test/i.test(cmd),
    );
    expect(forbidden).toEqual([]);
    expect(cmds).toContain('list_ai_providers');
  });
});

// afterEach is hoisted by vitest; declared here for clarity but referenced above.
import { afterEach } from 'vitest';
