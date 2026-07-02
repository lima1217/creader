import { useCallback, useEffect, useMemo, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { TabList, Tab } from '@astryxdesign/core/TabList';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Field } from '@astryxdesign/core/Field';
import { FieldStatus } from '@astryxdesign/core/FieldStatus';
import { Switch } from '@astryxdesign/core/Switch';
import { Button } from '@astryxdesign/core/Button';
import { ButtonGroup } from '@astryxdesign/core/ButtonGroup';
import { useSettings } from '../stores/AppContext';
import { ensureReadingMemoryRepository } from '../services/ReadingMemory';
import { isTauriRuntime } from '../utils/tauri';
import { createLogger } from '../utils/logger';
import { useAIProviders } from './ai/hooks/useAIProviders';
import type { AIProviderConfig } from '../types';
import { CheckIcon, CloseIcon, PlusIcon } from './ai/icons';
import {
    getMissingDefaultQuickActions,
    loadQuickActionConfigs,
    renderQuickActionIcon,
    saveQuickActionConfigs,
} from './ai/quickActions';
import type { QuickActionConfig } from './ai/quickActions';
import {
    addQuickAction,
    applyProviderTemplate,
    clampAITextSize,
    commitQuickActionDraft,
    createCustomQuickAction,
    hideQuickAction,
    resetQuickActions,
    restoreQuickAction,
    validateProviderDraft,
} from './settingsPanelLogic';
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

type SettingsSection = 'ai' | 'memory' | 'prompts';

const contextWindowOptions = [
    { value: 5, label: '近 5 条', hint: '快' },
    { value: 20, label: '近 20 条', hint: '平衡' },
    { value: 40, label: '近 40 条', hint: '长对话' },
] as const;

const sectionTabs: Array<{ id: SettingsSection; label: string; hint: string }> = [
    { id: 'ai', label: 'AI', hint: '服务与上下文' },
    { id: 'memory', label: '阅读记忆', hint: '本地知识库' },
    { id: 'prompts', label: '快捷提示词', hint: '底部按钮' },
];

type SettingsPanelProps = {
    isOpen: boolean;
    onClose: () => void;
};

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
    const { settings, setSettings } = useSettings();
    const isTauri = isTauriRuntime();
    const aiProviders = useAIProviders({ isTauri, active: isOpen });
    const [isMemoryBusy, setMemoryBusy] = useState(false);
    const [quickActionConfigs, setQuickActionConfigs] = useState<QuickActionConfig[]>(loadQuickActionConfigs);
    const [editingActionId, setEditingActionId] = useState<string | null>(quickActionConfigs[0]?.id || null);
    const [quickActionDraft, setQuickActionDraft] = useState({ label: '', prompt: '' });
    const [activeSection, setActiveSection] = useState<SettingsSection>('ai');

    // Provider editor state.
    const emptyDraft: AIProviderConfig = useMemo(() => ({ id: newProviderId(), name: '', baseUrl: '', model: '' }), []);
    const [editingProvider, setEditingProvider] = useState<AIProviderConfig | null>(null);
    const [draftKey, setDraftKey] = useState('');
    const [providerError, setProviderError] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        setActiveSection('ai');
        setEditingProvider(null);
        setDraftKey('');
        setProviderError('');
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

    const adjustAITextSize = (delta: number) => {
        const nextSize = clampAITextSize(settings.aiTextSize + delta);
        setSettings({ ...settings, aiTextSize: nextSize });
    };

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

    const resetQuickActionsHandler = () => {
        const { actions, editingId } = resetQuickActions();
        persistQuickActions(actions);
        setEditingActionId(editingId);
    };

    const missingDefaultQuickActions = getMissingDefaultQuickActions(quickActionConfigs);

    return (
        <Dialog
            isOpen={isOpen}
            onOpenChange={open => { if (!open) onClose(); }}
            width={560}
            maxHeight="80vh"
            purpose="form"
            className="settings-dialog"
        >
            <Layout>
                <DialogHeader
                    title="设置"
                    subtitle="阅读记忆与 AI 运行方式"
                    onOpenChange={open => { if (!open) onClose(); }}
                />
                <LayoutContent isScrollable>
                    <div className="settings-tabs-row">
                        <TabList
                            value={activeSection}
                            onChange={value => setActiveSection(value as SettingsSection)}
                            layout="fill"
                            hasDivider
                            aria-label="设置分类"
                        >
                            {sectionTabs.map(tab => (
                                <Tab key={tab.id} value={tab.id} label={tab.label} />
                            ))}
                        </TabList>
                    </div>

                {activeSection === 'ai' && (
                    <div className="settings-section">
                        <div className="settings-section-title">AI 服务</div>

                    {editingProvider ? (
                        <div className="settings-provider-editor">
                            <Field
                                inputID="settings-provider-name"
                                label="名称"
                                isRequired
                            >
                                <TextInput
                                    label="名称"
                                    isLabelHidden
                                    value={editingProvider.name}
                                    onChange={value => setEditingProvider({ ...editingProvider, name: value })}
                                    placeholder="如 DeepSeek"
                                    htmlName="settings-provider-name"
                                />
                            </Field>
                            <Field
                                inputID="settings-provider-base-url"
                                label="Base URL（OpenAI 兼容）"
                                isRequired
                            >
                                <TextInput
                                    label="Base URL（OpenAI 兼容）"
                                    isLabelHidden
                                    value={editingProvider.baseUrl}
                                    onChange={value => setEditingProvider({ ...editingProvider, baseUrl: value })}
                                    placeholder="https://api.deepseek.com/v1"
                                    htmlName="settings-provider-base-url"
                                />
                            </Field>
                            <Field
                                inputID="settings-provider-model"
                                label="模型"
                                isRequired
                            >
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
                            {aiProviders.providers.length === 0 ? (
                                <p className="settings-provider-empty">尚未添加 AI 服务。点下方「添加」配置一个 OpenAI 兼容服务。</p>
                            ) : (
                                <ul className="settings-provider-list">
                                    {aiProviders.providers.map(provider => (
                                        <li
                                            key={provider.id}
                                            className={`settings-provider-item ${provider.active ? 'active' : ''}`}
                                        >
                                            <button
                                                className="settings-provider-main"
                                                onClick={() => !provider.active && aiProviders.setActive(provider.id)}
                                                title={provider.active ? '当前启用的服务' : '点此启用'}
                                            >
                                                <span className={`settings-provider-dot ${provider.hasKey ? 'available' : 'unavailable'}`} />
                                                <span className="settings-provider-copy">
                                                    <span className="settings-provider-name">
                                                        {provider.name}
                                                        {provider.active && <CheckIcon />}
                                                    </span>
                                                    <small>{provider.model} · {provider.hasKey ? 'Key 已设置' : '未设置 Key'}</small>
                                                    <small className="settings-provider-url">{provider.baseUrl}</small>
                                                </span>
                                            </button>
                                            <div className="settings-provider-actions">
                                                <button
                                                    className="settings-icon-btn"
                                                    onClick={() => startEditProvider(provider)}
                                                    title="编辑"
                                                >
                                                    编辑
                                                </button>
                                                <button
                                                    className="settings-icon-btn settings-danger-action"
                                                    onClick={() => aiProviders.deleteProvider(provider.id)}
                                                    title="删除"
                                                >
                                                    删除
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}

                            <div className="settings-provider-add">
                                <Button
                                    variant="secondary"
                                    label="添加 AI 服务"
                                    icon={<PlusIcon />}
                                    onClick={startNewProvider}
                                    isDisabled={!isTauri}
                                />
                            </div>
                        </>
                    )}

                    <div className="settings-divider" />

                    <div className="settings-field">
                        <div className="settings-field-copy">
                            <div className="settings-field-label">AI 文字大小</div>
                            <div className="settings-field-hint">调整旁注正文和输入框文字。</div>
                        </div>
                        <ButtonGroup label="AI 文字大小" size="sm">
                            <Button
                                label="减小 AI 文字"
                                isIconOnly
                                icon={<span aria-hidden="true">−</span>}
                                onClick={() => adjustAITextSize(-1)}
                                isDisabled={settings.aiTextSize <= 13}
                            />
                            <span className="settings-stepper-value" aria-live="polite">{settings.aiTextSize}px</span>
                            <Button
                                label="增大 AI 文字"
                                isIconOnly
                                icon={<span aria-hidden="true">+</span>}
                                onClick={() => adjustAITextSize(1)}
                                isDisabled={settings.aiTextSize >= 20}
                            />
                        </ButtonGroup>
                    </div>

                    <Field
                        className="settings-field settings-field-stacked"
                        inputID="settings-context-window"
                        label="上下文轮次"
                        description="每次提问带上的最近记录，越多越连贯，也越慢。"
                    >
                        <div className="settings-segmented" aria-label="AI 上下文轮次" id="settings-context-window">
                            {contextWindowOptions.map(option => (
                                <Button
                                    key={option.value}
                                    variant={settings.aiContextWindow === option.value ? 'primary' : 'secondary'}
                                    size="sm"
                                    label={option.label}
                                    onClick={() => setSettings({ ...settings, aiContextWindow: option.value })}
                                />
                            ))}
                        </div>
                    </Field>

                    <Switch
                        label="自动压缩"
                        description="超过轮次后，将更早对话压成隐藏摘要继续带上。"
                        value={settings.aiAutoSummarize}
                        onChange={checked => setSettings({ ...settings, aiAutoSummarize: checked })}
                    />
                    </div>
                )}

                {activeSection === 'memory' && (
                    <div className="settings-section">
                        <div className="settings-section-title">阅读记忆</div>
                    <div className="settings-field">
                        <div className="settings-field-copy">
                            <div className="settings-field-label">Markdown 仓库</div>
                            <div className="settings-field-hint">
                                AI 只在值得保留时写入知识页，后续可交给外部整理。
                            </div>
                        </div>
                        <button className="settings-primary-action" onClick={chooseReadingMemory} disabled={!isTauri || isMemoryBusy}>
                            {settings.readingMemoryPath ? '更换' : '选择'}
                        </button>
                    </div>
                    {settings.readingMemoryPath && (
                        <div className="settings-inline-path">
                            <code>{settings.readingMemoryPath}</code>
                            <button onClick={openReadingMemory}>打开</button>
                        </div>
                    )}
                    <label className="settings-toggle-row">
                        <span>
                            <strong>自动沉淀</strong>
                            <small>AI 判断有长期价值时，自动写入本地仓库。</small>
                        </span>
                        <span className="settings-switch">
                            <input
                                type="checkbox"
                                checked={settings.readingMemoryAutoIngest}
                                onChange={event => setSettings({ ...settings, readingMemoryAutoIngest: event.target.checked })}
                            />
                            <span className="settings-switch-track" aria-hidden="true" />
                        </span>
                    </label>
                    </div>
                )}

                {activeSection === 'prompts' && (
                    <div className="settings-section">
                        <div className="settings-section-title">快捷提示词</div>
                    <div className="settings-quick-actions">
                        <div className="settings-quick-list">
                            <button className="settings-quick-add-main settings-restore-action" onClick={addQuickActionHandler}>
                                <PlusIcon />
                                <span>新增提示词</span>
                            </button>
                            {quickActionConfigs.length > 0 ? (
                                quickActionConfigs.map(action => (
                                    <div
                                        key={action.id}
                                        className={`settings-quick-item ${editingActionId === action.id ? 'active' : ''}`}
                                    >
                                        <button
                                            className="settings-quick-select"
                                            onClick={() => setEditingActionId(action.id)}
                                        >
                                            {renderQuickActionIcon(action.icon)}
                                            <span>{action.label}</span>
                                        </button>
                                        <button
                                            className="settings-quick-hide settings-danger-action"
                                            onClick={() => hideQuickActionHandler(action.id)}
                                            aria-label={`隐藏 ${action.label}`}
                                        >
                                            <CloseIcon />
                                        </button>
                                    </div>
                                ))
                            ) : (
                                <div className="settings-quick-muted">所有提示词按钮都已隐藏。</div>
                            )}

                            {missingDefaultQuickActions.length > 0 && (
                                <div className="settings-quick-restore">
                                    <div className="settings-section-title">恢复隐藏项</div>
                                    {missingDefaultQuickActions.map(action => (
                                        <button
                                            key={action.id}
                                            className="settings-quick-restore-btn settings-restore-action"
                                            onClick={() => restoreQuickActionHandler(action)}
                                        >
                                            <PlusIcon />
                                            <span>{action.label}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {editingActionId ? (
                            <div className="settings-quick-form">
                                <label>
                                    <span>按钮名称</span>
                                    <input
                                        value={quickActionDraft.label}
                                        onChange={(event) => setQuickActionDraft(draft => ({ ...draft, label: event.target.value }))}
                                        placeholder="按钮名称"
                                    />
                                </label>
                                <label>
                                    <span>提示词</span>
                                    <textarea
                                        value={quickActionDraft.prompt}
                                        onChange={(event) => setQuickActionDraft(draft => ({ ...draft, prompt: event.target.value }))}
                                        placeholder="提示词"
                                        rows={7}
                                    />
                                </label>
                                <div className="settings-quick-actions-row">
                                    <button className="settings-secondary-action settings-restore-action" onClick={resetQuickActionsHandler}>
                                        恢复默认
                                    </button>
                                    <button
                                        className="settings-primary-action"
                                        onClick={saveQuickActionDraft}
                                        disabled={!quickActionDraft.label.trim() || !quickActionDraft.prompt.trim()}
                                    >
                                        保存
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="settings-quick-empty">
                                <span>选择一个提示词按钮来编辑。</span>
                                <button className="settings-secondary-action settings-restore-action" onClick={resetQuickActionsHandler}>
                                    恢复默认
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="settings-field-hint settings-quick-help">旁注面板底部最多显示前 6 个按钮，其余进入“更多”。</div>
                    </div>
                )}
                </LayoutContent>
            </Layout>
        </Dialog>
    );
}
