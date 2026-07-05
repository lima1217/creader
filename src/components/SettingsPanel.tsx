import { useCallback, useEffect, useMemo, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Field } from '@astryxdesign/core/Field';
import { FieldStatus } from '@astryxdesign/core/FieldStatus';
import { Switch } from '@astryxdesign/core/Switch';
import { Button } from '@astryxdesign/core/Button';
import { ButtonGroup } from '@astryxdesign/core/ButtonGroup';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { useSettingsStore } from '../stores/settingsStore';
import { ensureReadingMemoryRepository } from '../services/ReadingMemory';
import { isTauriRuntime } from '../utils/tauri';
import { createLogger } from '../utils/logger';
import { useAIProviders } from './ai/hooks/useAIProviders';
import type { AIProviderConfig, AIProviderStatus, Settings } from '../types';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, PlusIcon } from './ai/icons';
import {
    getMissingDefaultQuickActions,
    loadQuickActionConfigs,
    saveQuickActionConfigs,
} from './ai/quickActions';
import type { QuickActionConfig } from './ai/quickActions';
import {
    AI_TEXT_SIZE_MAX,
    AI_TEXT_SIZE_MIN,
    addQuickAction,
    applyProviderTemplate,
    clampAITextSize,
    commitQuickActionDraft,
    createCustomQuickAction,
    formatQuickPromptStatus,
    hideQuickAction,
    moveQuickActionDown,
    moveQuickActionUp,
    resetQuickActions,
    restoreQuickAction,
    validateProviderDraft,
} from './settingsPanelLogic';
import {
    isAiServiceReady,
    resolveProviderCandidate,
} from './aiServiceReadiness';
import './SettingsPanel.css';

const logger = createLogger('SettingsPanel');

// Quick-fill templates for common OpenAI-compatible endpoints.
const providerTemplates: Array<{ name: string; baseUrl: string; model: string }> = [
    { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { name: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    { name: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
];

function newProviderId() {
    return `prov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Session-only UI state for an explicit AI Service connection test. Never
// persisted into provider config, never fed into the AI tab attention state.
type ProviderTestState = {
    status: 'loading' | 'success' | 'error';
    message: string;
};

const contextWindowOptions = [
    { value: 5, label: '近 5 条', hint: '快' },
    { value: 20, label: '近 20 条', hint: '平衡' },
    { value: 40, label: '近 40 条', hint: '长对话' },
] as const;

type SettingsTabId = 'ai' | 'reading-memory' | 'quick-prompts';

type SettingsPanelProps = {
    isOpen: boolean;
    onClose: () => void;
};

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
    const settings = useSettingsStore((s) => s.settings);
    const setSettings = useSettingsStore((s) => s.setSettings);
    const isTauri = isTauriRuntime();
    const aiProviders = useAIProviders({ isTauri, active: isOpen });
    const [isMemoryBusy, setMemoryBusy] = useState(false);
    const [quickActionConfigs, setQuickActionConfigs] = useState<QuickActionConfig[]>(loadQuickActionConfigs);
    const [editingActionId, setEditingActionId] = useState<string | null>(quickActionConfigs[0]?.id || null);
    const [quickActionDraft, setQuickActionDraft] = useState({ label: '', prompt: '' });
    const [activeTab, setActiveTab] = useState<SettingsTabId>('ai');

    // Provider editor state.
    const emptyDraft: AIProviderConfig = useMemo(() => ({ id: newProviderId(), name: '', baseUrl: '', model: '' }), []);
    const [editingProvider, setEditingProvider] = useState<AIProviderConfig | null>(null);
    const [draftKey, setDraftKey] = useState('');
    const [providerError, setProviderError] = useState('');

    // Per-provider connection-test state. Session-only: closing/reopening
    // settings clears results. Never persisted, never feeds AI tab attention.
    const [providerTests, setProviderTests] = useState<Record<string, ProviderTestState>>({});

    useEffect(() => {
        if (!isOpen) return;
        setActiveTab('ai');
        setEditingProvider(null);
        setDraftKey('');
        setProviderError('');
        // Connection test results do not survive a settings reopen.
        setProviderTests({});
        const loadedActions = loadQuickActionConfigs();
        setQuickActionConfigs(loadedActions);
        setEditingActionId(loadedActions[0]?.id || null);
    }, [isOpen]);

    useEffect(() => {
        const editingAction = quickActionConfigs.find(action => action.id === editingActionId);
        setQuickActionDraft({
            label: editingAction?.label || '',
            prompt: editingAction?.prompt || '',
        });
    }, [editingActionId, quickActionConfigs]);

    const startNewProvider = useCallback(() => {
        setProviderError('');
        setDraftKey('');
        setEditingProvider({ ...emptyDraft, id: newProviderId() });
    }, [emptyDraft]);

    const startEditProvider = useCallback((config: AIProviderConfig) => {
        setProviderError('');
        setDraftKey('');
        setEditingProvider({ ...config });
    }, []);

    const applyTemplate = useCallback((template: { name: string; baseUrl: string; model: string }) => {
        setEditingProvider(prev => applyProviderTemplate(prev, template));
    }, []);

    const saveEditingProvider = useCallback(async (activate: boolean) => {
        if (!editingProvider) return;
        const error = validateProviderDraft(editingProvider);
        if (error) {
            setProviderError(error);
            return;
        }
        try {
            await aiProviders.saveProvider(editingProvider, {
                activate,
                apiKey: draftKey.trim() || undefined,
            });
            setEditingProvider(null);
            setDraftKey('');
            setProviderError('');
        } catch (saveError) {
            setProviderError(String(saveError instanceof Error ? saveError.message : saveError));
        }
    }, [aiProviders, editingProvider, draftKey]);

    // Explicit per-provider connection test. Uses the saved provider record and
    // its local key; never runs from the Overview. The result is session-only
    // UI feedback and is not written back into provider config or readiness.
    const runProviderTest = useCallback(async (provider: AIProviderStatus) => {
        if (!isTauri) return;
        setProviderTests(prev => ({
            ...prev,
            [provider.id]: { status: 'loading', message: '正在测试连接…' },
        }));
        try {
            const message = await aiProviders.testProvider(provider.id);
            setProviderTests(prev => ({
                ...prev,
                [provider.id]: { status: 'success', message },
            }));
        } catch (testError) {
            const message = String(testError instanceof Error ? testError.message : testError);
            setProviderTests(prev => ({
                ...prev,
                [provider.id]: { status: 'error', message },
            }));
        }
    }, [aiProviders, isTauri]);

    const chooseReadingMemory = async () => {
        if (!isTauri || isMemoryBusy) return;
        setMemoryBusy(true);
        try {
            const selected = await openDialog({
                directory: true,
                multiple: false,
                title: '选择阅读记忆仓库',
            });
            if (!selected || Array.isArray(selected)) return;
            const rootPath = await ensureReadingMemoryRepository(selected);
            setSettings({
                ...settings,
                readingMemoryPath: rootPath,
                readingMemoryAutoIngest: true,
            });
        } catch (error) {
            logger.error('Failed to configure Reading Memory:', error);
        } finally {
            setMemoryBusy(false);
        }
    };

    const openReadingMemory = async () => {
        if (!settings.readingMemoryPath || !isTauri) return;
        try {
            await openPath(settings.readingMemoryPath);
        } catch (error) {
            logger.error('Failed to open Reading Memory:', error);
        }
    };

    const persistQuickActions = (actions: QuickActionConfig[]) => {
        setQuickActionConfigs(actions);
        saveQuickActionConfigs(actions);
    };

    const saveQuickActionDraft = () => {
        const nextActions = commitQuickActionDraft(quickActionConfigs, editingActionId, quickActionDraft);
        if (nextActions) persistQuickActions(nextActions);
    };

    const hideQuickActionHandler = (actionId: string) => {
        const { actions, nextEditingId } = hideQuickAction(quickActionConfigs, actionId, editingActionId);
        persistQuickActions(actions);
        setEditingActionId(nextEditingId);
    };

    const addQuickActionHandler = () => {
        const action = createCustomQuickAction();
        const { actions, editingId } = addQuickAction(quickActionConfigs, action);
        persistQuickActions(actions);
        setEditingActionId(editingId);
    };

    const restoreQuickActionHandler = (action: QuickActionConfig) => {
        const { actions, editingId } = restoreQuickAction(quickActionConfigs, action);
        persistQuickActions(actions);
        setEditingActionId(editingId);
    };

    // Reordering moves an action up/down in the persisted array, which directly
    // reshuffles the first-six direct-button set the AI panel renders.
    const moveQuickActionUpHandler = (actionId: string) => {
        persistQuickActions(moveQuickActionUp(quickActionConfigs, actionId));
    };

    const moveQuickActionDownHandler = (actionId: string) => {
        persistQuickActions(moveQuickActionDown(quickActionConfigs, actionId));
    };

    const resetQuickActionsHandler = () => {
        const { actions, editingId } = resetQuickActions();
        persistQuickActions(actions);
        setEditingActionId(editingId);
    };

    const missingDefaultQuickActions = getMissingDefaultQuickActions(quickActionConfigs);
    const quickPromptStatus = formatQuickPromptStatus(quickActionConfigs);

    // Local-only setup signal: do not call providers while opening settings.
    const aiServiceReady = useMemo(() => isAiServiceReady(aiProviders.providers), [aiProviders.providers]);
    const candidateProvider = resolveProviderCandidate(aiProviders.providers);

    const switchTab = useCallback((tab: string) => {
        setActiveTab(tab as SettingsTabId);
        if (tab !== 'ai') {
            setEditingProvider(null);
            setProviderError('');
        }
    }, []);

    const adjustAITextSize = useCallback((delta: number) => {
        setSettings({
            ...settings,
            aiTextSize: clampAITextSize(settings.aiTextSize + delta),
        });
    }, [settings, setSettings]);

    return (
        <Dialog
            isOpen={isOpen}
            onOpenChange={open => { if (!open) onClose(); }}
            width={720}
            maxHeight="86vh"
            purpose="form"
            className="settings-dialog"
        >
            <Layout className="settings-dialog-layout">
                <div className="settings-dialog-header settings-dialog-header-close">
                    <Button
                        variant="ghost"
                        label="关闭设置"
                        isIconOnly
                        icon={<CloseIcon />}
                        onClick={onClose}
                    />
                </div>
                <div className="settings-tabs-row">
                    <TabList
                        value={activeTab}
                        onChange={switchTab}
                        size="sm"
                        layout="fill"
                        hasDivider
                    >
                        <Tab
                            value="ai"
                            label="AI 设置"
                            endContent={!aiServiceReady ? (
                                <span className="settings-tab-attention" aria-label="需要配置 AI 服务" />
                            ) : undefined}
                        />
                        <Tab value="reading-memory" label="阅读记忆" />
                        <Tab value="quick-prompts" label="快捷提示词" />
                    </TabList>
                </div>
                <LayoutContent isScrollable className="settings-content">
                    {activeTab === 'ai' && (
                        <div className="settings-section settings-section-stack">
                            <section className="settings-subsection">
                                <div className="settings-section-title">AI 服务</div>

                                {editingProvider ? (
                                    <div className="settings-provider-editor">
                                        <Field inputID="settings-provider-name" label="名称" isRequired>
                                            <TextInput
                                                label="名称"
                                                isLabelHidden
                                                value={editingProvider.name}
                                                onChange={value => setEditingProvider({ ...editingProvider, name: value })}
                                                placeholder="如 DeepSeek"
                                                htmlName="settings-provider-name"
                                            />
                                        </Field>
                                        <Field inputID="settings-provider-base-url" label="Base URL（OpenAI 兼容）" isRequired>
                                            <TextInput
                                                label="Base URL（OpenAI 兼容）"
                                                isLabelHidden
                                                value={editingProvider.baseUrl}
                                                onChange={value => setEditingProvider({ ...editingProvider, baseUrl: value })}
                                                placeholder="https://api.deepseek.com/v1"
                                                htmlName="settings-provider-base-url"
                                            />
                                        </Field>
                                        <Field inputID="settings-provider-model" label="模型" isRequired>
                                            <TextInput
                                                label="模型"
                                                isLabelHidden
                                                value={editingProvider.model}
                                                onChange={value => setEditingProvider({ ...editingProvider, model: value })}
                                                placeholder="deepseek-chat"
                                                htmlName="settings-provider-model"
                                            />
                                        </Field>
                                        <Field
                                            inputID="settings-provider-key"
                                            label="API Key（存入本地配置文件，不回显）"
                                            description="留空则保留已保存的 Key"
                                        >
                                            <TextInput
                                                label="API Key（存入本地配置文件，不回显）"
                                                isLabelHidden
                                                type="password"
                                                value={draftKey}
                                                onChange={value => setDraftKey(value)}
                                                placeholder="留空则保留已保存的 Key"
                                                htmlName="settings-provider-key"
                                            />
                                        </Field>

                                        <div className="settings-provider-templates">
                                            <small>快捷填充：</small>
                                            <ButtonGroup label="快捷填充">
                                                {providerTemplates.map(template => (
                                                    <Button
                                                        key={template.name}
                                                        variant="secondary"
                                                        size="sm"
                                                        label={template.name}
                                                        onClick={() => applyTemplate(template)}
                                                    />
                                                ))}
                                            </ButtonGroup>
                                        </div>

                                        {providerError && (
                                            <FieldStatus type="error" message={providerError} variant="detached" />
                                        )}

                                        <div className="settings-provider-edit-actions">
                                            <Button
                                                variant="ghost"
                                                label="取消"
                                                onClick={() => { setEditingProvider(null); setProviderError(''); }}
                                            />
                                            <Button
                                                variant="secondary"
                                                label="保存"
                                                onClick={() => saveEditingProvider(false)}
                                            />
                                            <Button
                                                variant="primary"
                                                label="保存并启用"
                                                onClick={() => saveEditingProvider(true)}
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="settings-provider-summary">
                                            <span className={`settings-provider-dot ${candidateProvider?.hasKey ? 'available' : 'unavailable'}`} />
                                            <span className="settings-provider-summary-copy">
                                                <strong>{candidateProvider ? candidateProvider.name : '尚未配置 AI 服务'}</strong>
                                                <small>
                                                    {candidateProvider
                                                        ? `${candidateProvider.model} · ${candidateProvider.hasKey ? 'Key 已设置' : '未设置 Key'}`
                                                        : '添加一个 OpenAI 兼容服务后即可使用 AI。'}
                                                </small>
                                                {candidateProvider && (
                                                    <small className="settings-provider-url">{candidateProvider.baseUrl}</small>
                                                )}
                                            </span>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                label={candidateProvider ? '添加' : '添加 AI 服务'}
                                                icon={<PlusIcon />}
                                                onClick={startNewProvider}
                                                isDisabled={!isTauri}
                                            />
                                        </div>

                                        {aiProviders.providers.length > 0 && (
                                            <Collapsible
                                                className="settings-provider-collapsible"
                                                defaultIsOpen={false}
                                                trigger={(
                                                    <span className="settings-provider-collapsible-trigger">
                                                        <span>管理服务</span>
                                                        <small>{aiProviders.providers.length} 个服务，可切换、编辑或删除</small>
                                                    </span>
                                                )}
                                            >
                                                <ul className="settings-provider-list">
                                                    {aiProviders.providers.map(provider => {
                                                        const test = providerTests[provider.id];
                                                        const isTestLoading = test?.status === 'loading';
                                                        return (
                                                            <li
                                                                key={provider.id}
                                                                className={`settings-provider-item ${provider.active ? 'active' : ''}`}
                                                            >
                                                                <button
                                                                    className="settings-provider-main"
                                                                    onClick={() => !provider.active && aiProviders.setActive(provider.id)}
                                                                    aria-label={provider.active ? `${provider.name}，当前启用的服务` : `启用 ${provider.name}`}
                                                                >
                                                                    <span className={`settings-provider-dot ${provider.hasKey ? 'available' : 'unavailable'}`} />
                                                                    <span className="settings-provider-copy">
                                                                        <span className="settings-provider-name">
                                                                            {provider.name}
                                                                            {provider.active && <CheckIcon />}
                                                                        </span>
                                                                        <small>{provider.model} · {provider.hasKey ? 'Key 已设置' : '未设置 Key'}</small>
                                                                        <small className="settings-provider-url">{provider.baseUrl}</small>
                                                                        {test && (
                                                                            <span
                                                                                className="settings-provider-test"
                                                                                data-test-status={test.status}
                                                                                role="status"
                                                                            >
                                                                                {test.status === 'success' && <CheckIcon />}
                                                                                {test.status === 'error' && <CloseIcon />}
                                                                                <span>{test.message}</span>
                                                                            </span>
                                                                        )}
                                                                    </span>
                                                                </button>
                                                                <div className="settings-provider-actions">
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        label={isTestLoading ? '测试中…' : '测试'}
                                                                        onClick={() => runProviderTest(provider)}
                                                                        isDisabled={isTestLoading || !isTauri}
                                                                        aria-label={`测试 ${provider.name} 的连接`}
                                                                    />
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        label="编辑"
                                                                        onClick={() => startEditProvider(provider)}
                                                                    />
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        label="删除"
                                                                        onClick={() => aiProviders.deleteProvider(provider.id)}
                                                                    />
                                                                </div>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            </Collapsible>
                                        )}
                                    </>
                                )}
                            </section>

                            <section className="settings-subsection settings-subsection-separated">
                                <div className="settings-section-title">对话行为</div>
                                <div className="settings-conversation-behavior">
                                    <Field
                                        className="settings-field settings-conversation-control settings-conversation-primary"
                                        inputID="settings-context-window"
                                        label="上下文轮次"
                                    >
                                        <div id="settings-context-window">
                                            <SegmentedControl
                                                label="AI 上下文轮次"
                                                size="sm"
                                                layout="fill"
                                                value={String(settings.aiContextWindow)}
                                                onChange={value => setSettings({ ...settings, aiContextWindow: Number(value) as Settings['aiContextWindow'] })}
                                            >
                                                {contextWindowOptions.map(option => (
                                                    <SegmentedControlItem
                                                        key={option.value}
                                                        value={String(option.value)}
                                                        label={option.label}
                                                    />
                                                ))}
                                            </SegmentedControl>
                                        </div>
                                    </Field>

                                    <div className="settings-conversation-grid">
                                        <div className="settings-conversation-control settings-conversation-switch-control">
                                            <Switch
                                                label="自动压缩"
                                                labelPosition="start"
                                                labelSpacing="spread"
                                                value={settings.aiAutoSummarize}
                                                onChange={checked => setSettings({ ...settings, aiAutoSummarize: checked })}
                                            />
                                        </div>

                                        <Field
                                            className="settings-field settings-conversation-control settings-text-size-field"
                                            inputID="settings-ai-text-size"
                                            label="AI 文字大小"
                                        >
                                            <div className="settings-text-size-control" id="settings-ai-text-size">
                                                <Button
                                                    className="settings-text-size-step"
                                                    variant="secondary"
                                                    size="sm"
                                                    label="A-"
                                                    aria-label="减小 AI 文字大小"
                                                    onClick={() => adjustAITextSize(-1)}
                                                    isDisabled={settings.aiTextSize <= AI_TEXT_SIZE_MIN}
                                                />
                                                <NumberInput
                                                    label="AI 文字大小"
                                                    isLabelHidden
                                                    value={settings.aiTextSize}
                                                    onChange={value => setSettings({ ...settings, aiTextSize: clampAITextSize(value) })}
                                                    min={AI_TEXT_SIZE_MIN}
                                                    max={AI_TEXT_SIZE_MAX}
                                                    step={1}
                                                    isIntegerOnly
                                                    size="sm"
                                                />
                                                <Button
                                                    className="settings-text-size-step"
                                                    variant="secondary"
                                                    size="sm"
                                                    label="A+"
                                                    aria-label="增大 AI 文字大小"
                                                    onClick={() => adjustAITextSize(1)}
                                                    isDisabled={settings.aiTextSize >= AI_TEXT_SIZE_MAX}
                                                />
                                            </div>
                                        </Field>
                                    </div>
                                </div>
                            </section>
                        </div>
                    )}

                    {activeTab === 'reading-memory' && (
                        <div className="settings-section">
                            <div className="settings-section-title">阅读记忆</div>
                            <div className="settings-memory-status">
                                {settings.readingMemoryPath ? (
                                    <>
                                        <strong>已连接</strong>
                                        <code>{settings.readingMemoryPath}</code>
                                        <small>
                                            {settings.readingMemoryAutoIngest
                                                ? '自动沉淀已开启，AI 判断有长期价值时写入当前书的 books/<book-slug>/ 目录。'
                                                : '自动沉淀已关闭；保留此偏好，重新连接仓库后即可恢复写入。'}
                                        </small>
                                    </>
                                ) : (
                                    <>
                                        <strong>未连接仓库</strong>
                                        <small>选择本地 Markdown 仓库后，AI 才能写入值得保留的笔记。</small>
                                    </>
                                )}
                            </div>

                            <Field
                                inputID="settings-memory-path"
                                label="Markdown 仓库"
                                description="AI 只在值得保留时写入知识页，后续可交给外部整理。"
                            >
                                <div className="settings-memory-picker" id="settings-memory-path">
                                    {settings.readingMemoryPath ? (
                                        <span className="settings-inline-path">
                                            <code>{settings.readingMemoryPath}</code>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                label="打开"
                                                onClick={openReadingMemory}
                                            />
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                label="更换"
                                                onClick={chooseReadingMemory}
                                                isDisabled={!isTauri || isMemoryBusy}
                                            />
                                        </span>
                                    ) : (
                                        <Button
                                            variant="primary"
                                            label="选择"
                                            onClick={chooseReadingMemory}
                                            isDisabled={!isTauri || isMemoryBusy}
                                        />
                                    )}
                                </div>
                            </Field>
                            <Switch
                                label="自动沉淀"
                                description="AI 判断有长期价值时，自动写入本地仓库。关闭后此偏好仍被保留。"
                                labelPosition="start"
                                labelSpacing="spread"
                                value={settings.readingMemoryAutoIngest}
                                onChange={checked => setSettings({ ...settings, readingMemoryAutoIngest: checked })}
                            />
                        </div>
                    )}

                    {activeTab === 'quick-prompts' && (
                        <div className="settings-section">
                            <div className="settings-section-title">快捷提示词</div>
                            <p className="settings-field-hint settings-quick-help">
                                {quickPromptStatus}。前 6 个直接显示，其余进入“更多”。用上移/下移调整顺序。
                            </p>
                            <div className="settings-quick-actions">
                                <div className="settings-quick-list">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        label="新增提示词"
                                        icon={<PlusIcon />}
                                        onClick={addQuickActionHandler}
                                    />
                                    {quickActionConfigs.length > 0 ? (
                                        quickActionConfigs.map((action, index) => (
                                            <div
                                                key={action.id}
                                                className={`settings-quick-item ${editingActionId === action.id ? 'active' : ''}`}
                                            >
                                                <button
                                                    className="settings-quick-select"
                                                    onClick={() => setEditingActionId(action.id)}
                                                >
                                                    <span>{action.label}</span>
                                                    {index < 6 && (
                                                        <small className="settings-quick-direct" aria-hidden="true">直接</small>
                                                    )}
                                                </button>
                                                <div className="settings-quick-order">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        isIconOnly
                                                        label={`上移 ${action.label}`}
                                                        icon={<ChevronUpIcon />}
                                                        onClick={() => moveQuickActionUpHandler(action.id)}
                                                        isDisabled={index === 0}
                                                    />
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        isIconOnly
                                                        label={`下移 ${action.label}`}
                                                        icon={<ChevronDownIcon />}
                                                        onClick={() => moveQuickActionDownHandler(action.id)}
                                                        isDisabled={index === quickActionConfigs.length - 1}
                                                    />
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        isIconOnly
                                                        label={`隐藏 ${action.label}`}
                                                        icon={<CloseIcon />}
                                                        onClick={() => hideQuickActionHandler(action.id)}
                                                    />
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="settings-quick-muted">所有提示词按钮都已隐藏。</div>
                                    )}

                                    {missingDefaultQuickActions.length > 0 && (
                                        <div className="settings-quick-restore">
                                            <div className="settings-section-title">恢复隐藏项</div>
                                            {missingDefaultQuickActions.map(action => (
                                                <Button
                                                    key={action.id}
                                                    variant="secondary"
                                                    size="sm"
                                                    label={action.label}
                                                    icon={<PlusIcon />}
                                                    onClick={() => restoreQuickActionHandler(action)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {editingActionId ? (
                                    <div className="settings-quick-form">
                                        <Field inputID="settings-quick-label" label="按钮名称">
                                            <TextInput
                                                label="按钮名称"
                                                isLabelHidden
                                                value={quickActionDraft.label}
                                                onChange={value => setQuickActionDraft(draft => ({ ...draft, label: value }))}
                                                placeholder="按钮名称"
                                                htmlName="settings-quick-label"
                                            />
                                        </Field>
                                        <Field inputID="settings-quick-prompt" label="提示词">
                                            <TextArea
                                                label="提示词"
                                                isLabelHidden
                                                value={quickActionDraft.prompt}
                                                onChange={value => setQuickActionDraft(draft => ({ ...draft, prompt: value }))}
                                                placeholder="提示词"
                                                rows={7}
                                                htmlName="settings-quick-prompt"
                                            />
                                        </Field>
                                        <div className="settings-quick-actions-row">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                label="恢复默认"
                                                onClick={resetQuickActionsHandler}
                                            />
                                            <Button
                                                variant="primary"
                                                size="sm"
                                                label="保存"
                                                onClick={saveQuickActionDraft}
                                                isDisabled={!quickActionDraft.label.trim() || !quickActionDraft.prompt.trim()}
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="settings-quick-empty">
                                        <span>选择一个提示词按钮来编辑。</span>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            label="恢复默认"
                                            onClick={resetQuickActionsHandler}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </LayoutContent>
            </Layout>
        </Dialog>
    );
}
