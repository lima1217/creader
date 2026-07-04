import { useCallback, useEffect, useMemo, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Field } from '@astryxdesign/core/Field';
import { FieldStatus } from '@astryxdesign/core/FieldStatus';
import { Switch } from '@astryxdesign/core/Switch';
import { Button } from '@astryxdesign/core/Button';
import { ButtonGroup } from '@astryxdesign/core/ButtonGroup';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Badge } from '@astryxdesign/core/Badge';
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { useSettingsStore } from '../stores/settingsStore';
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
import {
    CONSOLE_AREAS,
    computeAreaStatuses,
    computeOverallReadiness,
    computeSideNavBadges,
    resolveProviderCandidate,
    type ConsoleAreaId,
    type ConsoleReadiness,
} from './consoleReadiness';
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

const contextWindowOptions = [
    { value: 5, label: '近 5 条', hint: '快' },
    { value: 20, label: '近 20 条', hint: '平衡' },
    { value: 40, label: '近 40 条', hint: '长对话' },
] as const;

const readinessCopy: Record<ConsoleReadiness, { label: string; headline: string }> = {
    ready: {
        label: '已就绪',
        headline: '阅读 AI 已就绪。所有运行所需的能力都已配置。',
    },
    degraded: {
        label: '部分能力受限',
        headline: '阅读 AI 可以运行，但部分能力受限或未启用。',
    },
    missing: {
        label: '需要配置',
        headline: '阅读 AI 尚未就绪。完成下方配置后即可开始对话。',
    },
};

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
    const [activeSection, setActiveSection] = useState<ConsoleAreaId>('overview');

    // Provider editor state.
    const emptyDraft: AIProviderConfig = useMemo(() => ({ id: newProviderId(), name: '', baseUrl: '', model: '' }), []);
    const [editingProvider, setEditingProvider] = useState<AIProviderConfig | null>(null);
    const [draftKey, setDraftKey] = useState('');
    const [providerError, setProviderError] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        // The console always opens on the actionable Overview first.
        setActiveSection('overview');
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

    // ---- Console readiness (local configuration only — never calls a provider) ----
    const areaStatuses = useMemo(
        () => computeAreaStatuses({
            providers: aiProviders.providers,
            readingMemoryPath: settings.readingMemoryPath,
            readingMemoryAutoIngest: settings.readingMemoryAutoIngest,
            aiContextWindow: settings.aiContextWindow,
            aiAutoSummarize: settings.aiAutoSummarize,
            quickPromptCount: quickActionConfigs.length,
        }),
        [
            aiProviders.providers,
            settings.readingMemoryPath,
            settings.readingMemoryAutoIngest,
            settings.aiContextWindow,
            settings.aiAutoSummarize,
            quickActionConfigs.length,
        ],
    );
    const overallReadiness = useMemo(() => computeOverallReadiness(areaStatuses), [areaStatuses]);
    const sideNavBadges = useMemo(() => computeSideNavBadges(areaStatuses), [areaStatuses]);
    const candidateProvider = resolveProviderCandidate(aiProviders.providers);

    const goToArea = useCallback((area: ConsoleAreaId) => {
        setActiveSection(area);
        // Entering the AI Service area should not pre-open the editor; the
        // provider summary/list is the landing surface.
        if (area !== 'ai-service') {
            setEditingProvider(null);
            setProviderError('');
        }
    }, []);

    return (
        <Dialog
            isOpen={isOpen}
            onOpenChange={open => { if (!open) onClose(); }}
            width={840}
            maxHeight="86vh"
            purpose="form"
            className="settings-dialog console-dialog"
        >
            <Layout className="settings-dialog-layout console-layout">
                <DialogHeader
                    className="settings-dialog-header"
                    title="AI 阅读控制台"
                    subtitle="阅读 AI 运行状态与配置"
                    hasDivider={false}
                    endContent={(
                        <Button
                            variant="ghost"
                            label="关闭控制台"
                            isIconOnly
                            icon={<CloseIcon />}
                            onClick={onClose}
                        />
                    )}
                />
                <LayoutContent isScrollable={false} className="console-content">
                    <div className="console-sidenav">
                        <SideNav
                            aria-label="控制台导航"
                            topContent={
                                <button
                                    type="button"
                                    className="console-readiness-chip"
                                    data-readiness={overallReadiness}
                                    onClick={() => goToArea('overview')}
                                    aria-pressed={activeSection === 'overview'}
                                >
                                    <span className="console-readiness-dot" aria-hidden="true" />
                                    <span className="console-readiness-chip-copy">
                                        <strong>阅读 AI</strong>
                                        <small>{readinessCopy[overallReadiness].label}</small>
                                    </span>
                                </button>
                            }
                        >
                            <SideNavSection title="控制台导航" isHeaderHidden>
                                {CONSOLE_AREAS.map(area => {
                                    const badge = sideNavBadges.find(b => b.area === area.id);
                                    const isActive = activeSection === area.id;
                                    return (
                                        <SideNavItem
                                            key={area.id}
                                            label={area.label}
                                            isSelected={isActive}
                                            onClick={() => goToArea(area.id)}
                                            endContent={badge ? (
                                                <Badge
                                                    variant={badge.variant === 'error' ? 'error' : 'warning'}
                                                    label={badge.variant === 'error' ? '需配置' : '待完善'}
                                                />
                                            ) : undefined}
                                        />
                                    );
                                })}
                            </SideNavSection>
                        </SideNav>
                    </div>

                    <div className="console-main">
                    {activeSection === 'overview' && (
                        <ConsoleOverview
                            overallReadiness={overallReadiness}
                            statuses={areaStatuses}
                            candidateProviderName={candidateProvider?.name ?? null}
                            onJump={goToArea}
                        />
                    )}

                    {activeSection === 'ai-service' && (
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
                                            {aiProviders.providers.map(provider => (
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
                                                        </span>
                                                    </button>
                                                    <div className="settings-provider-actions">
                                                        <button
                                                            className="settings-icon-btn"
                                                            onClick={() => startEditProvider(provider)}
                                                        >
                                                            编辑
                                                        </button>
                                                        <button
                                                            className="settings-icon-btn settings-danger-action"
                                                            onClick={() => aiProviders.deleteProvider(provider.id)}
                                                        >
                                                            删除
                                                        </button>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </Collapsible>
                                )}
                            </>
                        )}
                        </div>
                    )}

                    {activeSection === 'conversation' && (
                        <div className="settings-section">
                            <div className="settings-section-title">对话行为</div>
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

                            <Switch
                                label="自动压缩"
                                description="超过轮次后，将更早对话压成隐藏摘要继续带上。"
                                value={settings.aiAutoSummarize}
                                onChange={checked => setSettings({ ...settings, aiAutoSummarize: checked })}
                            />

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
                        </div>
                    )}

                    {activeSection === 'reading-memory' && (
                        <div className="settings-section">
                            <div className="settings-section-title">阅读记忆</div>
                            <Field
                                inputID="settings-memory-path"
                                label="Markdown 仓库"
                                description="AI 只在值得保留时写入知识页，后续可交给外部整理。"
                            >
                                <div className="settings-memory-picker" id="settings-memory-path">
                                    <Button
                                        variant="primary"
                                        label={settings.readingMemoryPath ? '更换' : '选择'}
                                        onClick={chooseReadingMemory}
                                        isDisabled={!isTauri || isMemoryBusy}
                                    />
                                    {settings.readingMemoryPath && (
                                        <span className="settings-inline-path">
                                            <code>{settings.readingMemoryPath}</code>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                label="打开"
                                                onClick={openReadingMemory}
                                            />
                                        </span>
                                    )}
                                </div>
                            </Field>
                            <Switch
                                label="自动沉淀"
                                description="AI 判断有长期价值时，自动写入本地仓库。"
                                value={settings.readingMemoryAutoIngest}
                                onChange={checked => setSettings({ ...settings, readingMemoryAutoIngest: checked })}
                            />
                        </div>
                    )}

                    {activeSection === 'quick-prompts' && (
                        <div className="settings-section">
                            <div className="settings-section-title">快捷提示词</div>
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
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    isIconOnly
                                                    label={`隐藏 ${action.label}`}
                                                    icon={<CloseIcon />}
                                                    onClick={() => hideQuickActionHandler(action.id)}
                                                />
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
                            <div className="settings-field-hint settings-quick-help">旁注面板底部最多显示前 6 个按钮，其余进入“更多”。</div>
                        </div>
                    )}
                    </div>
                </LayoutContent>
            </Layout>
        </Dialog>
    );
}

type ConsoleOverviewProps = {
    overallReadiness: ConsoleReadiness;
    statuses: ReturnType<typeof computeAreaStatuses>;
    candidateProviderName: string | null;
    onJump: (area: ConsoleAreaId) => void;
};

function ConsoleOverview({ overallReadiness, statuses, candidateProviderName, onJump }: ConsoleOverviewProps) {
    const copy = readinessCopy[overallReadiness];
    const candidateCopy = candidateProviderName
        ? `当前候选服务：${candidateProviderName}。`
        : '配置一个 OpenAI 兼容服务即可开始。';
    return (
        <div className="console-section console-overview">
            <div className="settings-section-title">概览</div>
            <section
                className="console-hero"
                data-readiness={overallReadiness}
                aria-live="polite"
            >
                <div className="console-hero-copy">
                    <div className="console-hero-status">
                        <span className="console-readiness-dot" aria-hidden="true" />
                        <span>{copy.label}</span>
                    </div>
                    <p className="console-hero-headline">{copy.headline}</p>
                    <p className="console-hero-sub">{candidateCopy}控制台不会自动发起任何网络请求。</p>
                </div>
            </section>

            <ul className="console-status-list">
                {statuses.map(status => (
                    <li
                        key={status.area}
                        className="console-status-row"
                        data-readiness={status.readiness}
                    >
                        <div className="console-status-row-main">
                            <span className="console-status-row-dot" aria-hidden="true" />
                            <div className="console-status-row-copy">
                                <div className="console-status-row-title">{status.title}</div>
                                <div className="console-status-row-detail">{status.detail}</div>
                            </div>
                        </div>
                        <Button
                            variant={status.readiness === 'ready' ? 'secondary' : 'primary'}
                            size="sm"
                            label={status.actionLabel}
                            onClick={() => onJump(status.area)}
                        />
                    </li>
                ))}
            </ul>
        </div>
    );
}
