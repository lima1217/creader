import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { useSettingsStore } from '../stores/settingsStore';

import { installDialogElementStub, installResizeObserverStub } from './testUtils';

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
    if (cmd === 'test_ai_provider') {
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
  localStorage.setItem('creader-quick-actions', JSON.stringify({ v: 1, data: actions }));
}

describe('SettingsPanel — 三项一级菜单 (#62-#65)', () => {
  beforeEach(() => {
    installDialogElementStub();
    installResizeObserverStub();
    localStorage.clear();
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
    expect(container.textContent ?? '').toContain('自动压缩');
    expect(container.textContent ?? '').toContain('AI 文字大小');
    expect(container.textContent ?? '').not.toContain('px');
    expect(container.textContent ?? '').not.toContain('每次提问带上的最近记录');
    expect(container.textContent ?? '').not.toContain('超过轮次后');
    expect(container.textContent ?? '').not.toContain('调整旁注正文和输入框文字');
    expect(container.querySelector('#settings-context-window')).not.toBeNull();
    expect(container.querySelector('#settings-ai-text-size')).not.toBeNull();
    expect(container.querySelector('.astryx-number-input input')?.getAttribute('min')).toBe('13');
    expect(container.querySelector('.astryx-number-input input')?.getAttribute('max')).toBe('20');

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

    const raw = JSON.parse(localStorage.getItem('creader-quick-actions') ?? 'null');
    const actions = Array.isArray(raw) ? raw : raw?.data;
    expect(actions.map((a: { label: string }) => a.label)).toEqual(['二', '一', '三']);
  });
});

import { afterEach } from 'vitest';
