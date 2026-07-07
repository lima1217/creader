import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { useSettingsStore } from '../stores/settingsStore';

import { installDialogElementStub, installResizeObserverStub } from './testUtils';
import 'fake-indexeddb/auto';
import { APP_PREF_KEYS } from '../services/DexieDb';
import { loadAppPref } from '../services/AppPrefsStore';
import { resetIndexedDb } from '../services/indexedDbTestUtils';
import { hydrateQuickActionConfigs, resetQuickActionConfigsCache } from './ai/quickActionStorage';

const {
  invokeCalls,
  resetInvokeCapture,
  setProviderList,
  getProviders,
  getTestResult,
  setTestResult,
  clearTestResult,
} = vi.hoisted(() => {
  const calls: Array<{ cmd: string; args: unknown }> = [];
  let providers: Array<{
    id: string;
    name: string;
    baseUrl: string;
    model: string;
    active: boolean;
    hasKey: boolean;
  }> = [];
  type TestResult = { kind: 'resolve'; value: string } | { kind: 'reject'; message: string };
  let testResult: TestResult | null = null;
  return {
    invokeCalls: calls,
    resetInvokeCapture: () => {
      calls.length = 0;
    },
    setProviderList: (next: typeof providers) => {
      providers = next;
    },
    getProviders: () => providers,
    getTestResult: () => testResult,
    setTestResult: (next: TestResult) => {
      testResult = next;
    },
    clearTestResult: () => {
      testResult = null;
    },
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    invokeCalls.push({ cmd, args });
    if (cmd === 'list_ai_providers') return getProviders();
    if (cmd === 'test_ai_provider' || cmd === 'test_ai_provider_draft') {
      await new Promise((r) => setTimeout(r, 0));
      const result = getTestResult();
      clearTestResult();
      if (!result) throw new Error('no test result configured');
      if (result.kind === 'reject') throw new Error(result.message);
      return result.value;
    }
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
      readingMemoryPath: '/mem/root',
      readingMemoryAutoIngest: true,
      aiTextSize: 14,
      aiContextWindow: 20,
      aiToolRounds: 8,
      aiAutoSummarize: true,
      aiThinkingEnabled: false,
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

async function settleAsync() {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync(() => {});
  }
}

function tabs(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('.astryx-tab'));
}

function tabByLabel(container: HTMLElement, label: string): HTMLElement | undefined {
  return tabs(container).find((el) => (el.textContent ?? '').includes(label));
}

function clickTab(container: HTMLElement, label: string) {
  tabByLabel(container, label)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    (button.textContent ?? '').includes(label),
  ) as HTMLButtonElement | undefined;
}

function providerTestButton(container: HTMLElement, name: string): HTMLButtonElement | null {
  const item = Array.from(container.querySelectorAll('.settings-provider-item')).find((el) =>
    (el.textContent ?? '').includes(name),
  );
  return item?.querySelector('.settings-provider-actions button') as HTMLButtonElement | null;
}

function seedOrderedActions(labels: string[]) {
  const actions = labels.map((label, i) => ({
    id: `qa-${i}`,
    label,
    prompt: `prompt ${i}`,
  }));
  hydrateQuickActionConfigs(actions);
}

describe('SettingsPanel — 三项一级菜单 (#62-#65)', () => {
  beforeEach(async () => {
    await resetIndexedDb();
    installDialogElementStub();
    installResizeObserverStub();
    localStorage.clear();
    resetQuickActionConfigsCache();
    resetSettings();
    resetInvokeCapture();
    clearTestResult();
    setProviderList(DEFAULT_PROVIDERS);
  });

  afterEach(() => {
    unmountAll();
  });

  it('opens with three top-level tabs and no duplicate dialog title (#62)', async () => {
    const container = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();

    expect(container.querySelector('.settings-dialog-header h2')).toBeNull();
    expect(tabs(container).length).toBe(3);
    expect(tabByLabel(container, 'AI 设置')).toBeTruthy();
    expect(tabByLabel(container, '阅读记忆')).toBeTruthy();
    expect(tabByLabel(container, '快捷提示词')).toBeTruthy();
    expect(tabByLabel(container, 'AI 设置')?.hasAttribute('data-selected')).toBe(true);
    expect(container.querySelector('.console-sidenav')).toBeNull();
    expect(container.querySelector('.console-hero')).toBeNull();
    expect(container.querySelector('.console-status-row')).toBeNull();
    expect(container.querySelector('.console-strategy')).toBeNull();
  });

  it('shows AI service and grouped conversation behavior on the AI 设置 tab (#63)', async () => {
    const container = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();

    expect(container.querySelector('.settings-provider-summary')).not.toBeNull();
    expect(container.textContent ?? '').toContain('AI 服务');
    expect(container.textContent ?? '').toContain('对话行为');
    expect(container.querySelector('.settings-conversation-behavior')).not.toBeNull();
    expect(container.querySelector('.settings-conversation-grid')).not.toBeNull();
    expect(container.textContent ?? '').toContain('上下文轮次');
    expect(container.textContent ?? '').toContain('工具调用轮次');
    expect(container.textContent ?? '').toContain('自动压缩');
    expect(container.textContent ?? '').toContain('AI 文字大小');
    expect(container.textContent ?? '').not.toContain('px');
    expect(container.textContent ?? '').not.toContain('每次提问带上的最近记录');
    expect(container.textContent ?? '').not.toContain('超过轮次后');
    expect(container.textContent ?? '').not.toContain('调整旁注正文和输入框文字');
    expect(container.querySelector('#settings-context-window')).not.toBeNull();
    expect(container.querySelector('#settings-tool-rounds')).not.toBeNull();
    expect(container.querySelector('#settings-ai-text-size')).not.toBeNull();

    const numberInputs = Array.from(container.querySelectorAll('.astryx-number-input input'));
    expect(numberInputs).toHaveLength(3);
    expect(numberInputs.find(input => input.closest('#settings-context-window'))?.getAttribute('min')).toBe('1');
    expect(numberInputs.find(input => input.closest('#settings-context-window'))?.getAttribute('max')).toBe('100');
    expect(numberInputs.find(input => input.closest('#settings-tool-rounds'))?.getAttribute('min')).toBe('2');
    expect(numberInputs.find(input => input.closest('#settings-tool-rounds'))?.getAttribute('max')).toBe('24');
    expect(numberInputs.find(input => input.closest('#settings-ai-text-size'))?.getAttribute('min')).toBe('13');
    expect(numberInputs.find(input => input.closest('#settings-ai-text-size'))?.getAttribute('max')).toBe('20');

    const increaseTextSize = container.querySelector('button[aria-label="增大 AI 文字大小"]') as HTMLButtonElement;
    expect(increaseTextSize).not.toBeNull();
    increaseTextSize.click();
    await settle();
    expect(useSettingsStore.getState().settings.aiTextSize).toBe(15);
  });

  it('shows an attention dot only on the AI 设置 tab when no active keyed provider exists', async () => {
    setProviderList([]);
    const container = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();

    expect(tabByLabel(container, 'AI 设置')?.querySelector('.settings-tab-attention')).not.toBeNull();
    expect(tabByLabel(container, '阅读记忆')?.querySelector('.settings-tab-attention')).toBeNull();
    expect(tabByLabel(container, '快捷提示词')?.querySelector('.settings-tab-attention')).toBeNull();
  });

  it('does not show any positive readiness marker when AI service is ready', async () => {
    const container = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();

    expect(container.querySelector('.settings-tab-attention')).toBeNull();
    expect(container.textContent ?? '').not.toContain('已就绪');
  });

  it('does not trigger chat, stream, connect, or provider tests when opened', async () => {
    mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();

    const cmds = invokeCalls.map((c) => c.cmd);
    expect(cmds).toContain('list_ai_providers');
    expect(cmds.filter((cmd) => /chat|stream|connect|test/i.test(cmd))).toEqual([]);
  });

  it('runs an explicit provider connection test and clears the result on reopen', async () => {
    setTestResult({ kind: 'resolve', value: '连接成功：ok' });
    const first = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();

    providerTestButton(first, 'DeepSeek')?.click();
    await settleAsync();

    expect(invokeCalls.find((c) => c.cmd === 'test_ai_provider')).toBeTruthy();
    expect(first.querySelector('.settings-provider-test')?.textContent ?? '').toContain('连接成功');

    unmountAll();
    const reopened = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();
    expect(reopened.querySelector('.settings-provider-test')).toBeNull();
  });

  it('tests a draft provider from the editor without saving first', async () => {
    setTestResult({ kind: 'resolve', value: '连接成功：ok' });
    const container = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();

    // Enter the editor via the "添加" button.
    buttonByLabel(container, '添加')?.click();
    await settle();
    expect(container.querySelector('.settings-provider-editor')).not.toBeNull();

    // The test button is disabled until a draft key is entered.
    const testBtn = buttonByLabel(container, '测试连接');
    expect(testBtn).toBeTruthy();
    expect(testBtn?.disabled).toBe(true);

    // Fill a draft key to enable the test button. Use the native value setter so
    // React's controlled-input value tracker picks up the change.
    const keyInput = container.querySelector('input[type="password"]') as HTMLInputElement | null;
    expect(keyInput).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(keyInput, 'sk-draft');
    keyInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    expect(buttonByLabel(container, '测试连接')?.disabled).toBe(false);
    buttonByLabel(container, '测试连接')?.click();
    await settleAsync();

    // Draft test invoked the draft command with the in-memory config + key.
    const draftCall = invokeCalls.find((c) => c.cmd === 'test_ai_provider_draft');
    expect(draftCall).toBeTruthy();
    const args = draftCall!.args as { config: { baseUrl: string; model: string }; apiKey: string };
    expect(args.apiKey).toBe('sk-draft');
    // Success result rendered inline in the editor.
    expect(container.querySelector('.settings-provider-editor')?.textContent ?? '').toContain('连接成功');
    // No save happened during a draft-only test.
    expect(invokeCalls.find((c) => c.cmd === 'save_ai_provider')).toBeUndefined();
  });

  it('disables the auto-ingest switch when no Reading Memory repo is connected', async () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        readingMemoryPath: undefined,
        readingMemoryAutoIngest: true,
      },
    });
    const container = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();
    clickTab(container, '阅读记忆');
    await settle();

    const sw = container.querySelector('input[role="switch"]') as HTMLInputElement | null;
    expect(sw).toBeTruthy();
    expect(sw?.disabled).toBe(true);
  });

  it('shows open and replace actions when connected without a disconnect control (#64)', async () => {
    const container = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();
    clickTab(container, '阅读记忆');
    await settle();

    expect(container.querySelector('.console-strategy')).toBeNull();
    expect(container.textContent ?? '').toContain('/mem/root');
    expect(buttonByLabel(container, '打开')).toBeTruthy();
    expect(buttonByLabel(container, '更换')).toBeTruthy();
    expect(buttonByLabel(container, '断开仓库')).toBeUndefined();
  });

  it('shows a select action when Reading Memory is not connected (#64)', async () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        readingMemoryPath: undefined,
      },
    });
    const container = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();
    clickTab(container, '阅读记忆');
    await settle();

    expect(buttonByLabel(container, '选择')).toBeTruthy();
    expect(buttonByLabel(container, '打开')).toBeUndefined();
    expect(buttonByLabel(container, '更换')).toBeUndefined();
  });

  it('keeps Quick Prompt ordering and uses labeled edit fields (#65)', async () => {
    seedOrderedActions(['一', '二', '三']);
    const container = mount(<SettingsPanel isOpen={true} onClose={() => {}} />);
    await settle();
    clickTab(container, '快捷提示词');
    await settle();

    expect(container.querySelector('.console-strategy')).toBeNull();
    expect(container.querySelector('.settings-quick-help')?.textContent ?? '').toContain('前 6 个');
    expect(container.querySelector('.settings-quick-form')).not.toBeNull();
    expect(container.querySelector('input[name="settings-quick-label"]')).not.toBeNull();
    expect(container.querySelector('textarea[name="settings-quick-prompt"]')).not.toBeNull();

    const rows = container.querySelectorAll('.settings-quick-item');
    const secondRow = rows[1] as HTMLElement;
    const upBtn = secondRow.querySelector('.settings-quick-order button') as HTMLButtonElement;
    upBtn.click();
    await settle();

    const stored = await loadAppPref<Array<{ label: string }>>(APP_PREF_KEYS.quickActions);
    expect(stored?.map((a) => a.label)).toEqual(['二', '一', '三']);
  });
});

import { afterEach } from 'vitest';
