import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { useSettings } from '../stores/AppContext';
import { ensureReadingMemoryRepository } from '../services/ReadingMemory';
import { isTauriRuntime } from '../utils/tauri';
import { createLogger } from '../utils/logger';
import type { AIProviderInfo } from './ai/types';
import { CheckIcon, ChevronDownIcon, PlusIcon } from './ai/icons';
import {
    defaultQuickActions,
    getMissingDefaultQuickActions,
    loadQuickActionConfigs,
    renderQuickActionIcon,
    saveQuickActionConfigs,
} from './ai/quickActions';
import type { QuickActionConfig } from './ai/quickActions';
import './SettingsPanel.css';

const logger = createLogger('SettingsPanel');

const fallbackProviders: AIProviderInfo[] = [
    { id: 'claude', name: 'Claude Code', model: 'Claude', available: false },
    { id: 'opencode', name: 'OpenCode', model: 'OpenCode', available: false },
    { id: 'codex', name: 'Codex CLI', model: 'Codex', available: false },
];

type SettingsPanelProps = {
    isOpen: boolean;
    onClose: () => void;
};

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
    const { settings, setSettings } = useSettings();
    const isTauri = isTauriRuntime();
    const [providers, setProviders] = useState<AIProviderInfo[]>([]);
    const [isProviderOpen, setProviderOpen] = useState(false);
    const [isModelOpen, setModelOpen] = useState(false);
    const [isMemoryBusy, setMemoryBusy] = useState(false);
    const [quickActionConfigs, setQuickActionConfigs] = useState<QuickActionConfig[]>(loadQuickActionConfigs);
    const [editingActionId, setEditingActionId] = useState<string | null>(quickActionConfigs[0]?.id || null);
    const [quickActionDraft, setQuickActionDraft] = useState({ label: '', prompt: '' });

    const refreshProviders = useCallback(async () => {
        if (!isTauri) {
            setProviders(fallbackProviders);
            return;
        }
        try {
            const available = await invoke<AIProviderInfo[]>('refresh_ai_availability');
            setProviders(available);
        } catch (error) {
            logger.error('Failed to refresh AI providers:', error);
            setProviders([]);
        }
    }, [isTauri]);

    useEffect(() => {
        if (!isOpen) return;
        void refreshProviders();
        const loadedActions = loadQuickActionConfigs();
        setQuickActionConfigs(loadedActions);
        setEditingActionId(loadedActions[0]?.id || null);
    }, [isOpen, refreshProviders]);

    useEffect(() => {
        const editingAction = quickActionConfigs.find(action => action.id === editingActionId);
        setQuickActionDraft({
            label: editingAction?.label || '',
            prompt: editingAction?.prompt || '',
        });
    }, [editingActionId, quickActionConfigs]);

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    const selectedProvider = providers.find(p => p.id === settings.aiProvider) || {
        id: settings.aiProvider,
        name: settings.aiProvider,
        model: '',
        available: false,
    };

    const setProvider = async (providerId: string) => {
        setSettings({ ...settings, aiProvider: providerId });
        setProviderOpen(false);
        if (!isTauri) return;
        try {
            await invoke('set_ai_provider', { provider: providerId });
        } catch (error) {
            logger.error('Failed to set AI provider:', error);
        }
    };

    const setModel = (modelId: string) => {
        setSettings({ ...settings, aiModel: modelId });
        setModelOpen(false);
    };

    const chooseReadingMemory = async () => {
        if (!isTauri || isMemoryBusy) return;
        setMemoryBusy(true);
        try {
            const selected = await openDialog({
                directory: true,
                multiple: false,
                title: '选择 Reading Memory 仓库',
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
        if (!editingActionId) return;
        const label = quickActionDraft.label.trim();
        const prompt = quickActionDraft.prompt.trim();
        if (!label || !prompt) return;
        persistQuickActions(quickActionConfigs.map(action =>
            action.id === editingActionId ? { ...action, label, prompt } : action
        ));
    };

    const hideQuickAction = (actionId: string) => {
        const nextActions = quickActionConfigs.filter(action => action.id !== actionId);
        persistQuickActions(nextActions);
        if (editingActionId === actionId) {
            setEditingActionId(nextActions[0]?.id || null);
        }
    };

    const addQuickAction = () => {
        const action: QuickActionConfig = {
            id: `custom-${Date.now()}`,
            label: '新提示词',
            prompt: '请根据当前上下文回答：',
            icon: 'explain',
        };
        const nextActions = [...quickActionConfigs, action];
        persistQuickActions(nextActions);
        setEditingActionId(action.id);
    };

    const restoreQuickAction = (action: QuickActionConfig) => {
        const nextActions = [...quickActionConfigs, action];
        persistQuickActions(nextActions);
        setEditingActionId(action.id);
    };

    const resetQuickActions = () => {
        persistQuickActions(defaultQuickActions);
        setEditingActionId(defaultQuickActions[0]?.id || null);
    };

    const missingDefaultQuickActions = getMissingDefaultQuickActions(quickActionConfigs);

    if (!isOpen) return null;

    return (
        <div className="settings-overlay" role="presentation" onMouseDown={onClose}>
            <section
                className="settings-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-title"
                onMouseDown={event => event.stopPropagation()}
            >
                <header className="settings-panel-header">
                    <div>
                        <h2 id="settings-title">设置</h2>
                        <p>阅读记忆和 AI 运行方式</p>
                    </div>
                    <button className="settings-close" onClick={onClose} aria-label="关闭设置">x</button>
                </header>

                <div className="settings-section">
                    <div className="settings-section-title">AI Provider</div>
                    <div className="settings-row">
                        <div>
                            <div className="settings-label">提供方</div>
                            <div className="settings-help">隐藏到设置里，阅读时只保留对话本身。</div>
                        </div>
                        <div className="settings-select">
                            <button className="settings-select-trigger" onClick={() => setProviderOpen(open => !open)}>
                                <span className={`settings-provider-dot ${selectedProvider.available ? 'available' : 'unavailable'}`} />
                                <span>{selectedProvider.name}</span>
                                <ChevronDownIcon />
                            </button>
                            {isProviderOpen && (
                                <div className="settings-select-menu">
                                    {providers.map(provider => (
                                        <button
                                            key={provider.id}
                                            className={`settings-select-option ${provider.id === settings.aiProvider ? 'selected' : ''}`}
                                            onClick={() => setProvider(provider.id)}
                                            disabled={!provider.available && isTauri}
                                        >
                                            <span className={`settings-provider-dot ${provider.available ? 'available' : 'unavailable'}`} />
                                            <span className="settings-option-copy">
                                                <span>{provider.name}</span>
                                                <small>{provider.model}</small>
                                            </span>
                                            {provider.id === settings.aiProvider && <CheckIcon />}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {settings.aiProvider === 'claude' && (
                        <div className="settings-row">
                            <div>
                                <div className="settings-label">Claude 模型</div>
                                <div className="settings-help">用于阅读理解时的默认模型。</div>
                            </div>
                            <div className="settings-select settings-select-compact">
                                <button className="settings-select-trigger" onClick={() => setModelOpen(open => !open)}>
                                    <span>{settings.aiModel}</span>
                                    <ChevronDownIcon />
                                </button>
                                {isModelOpen && (
                                    <div className="settings-select-menu">
                                        {['sonnet', 'opus', 'haiku'].map(model => (
                                            <button
                                                key={model}
                                                className={`settings-select-option ${model === settings.aiModel ? 'selected' : ''}`}
                                                onClick={() => setModel(model)}
                                            >
                                                <span>{model}</span>
                                                {model === settings.aiModel && <CheckIcon />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <button className="settings-secondary-action" onClick={refreshProviders} disabled={!isTauri}>
                        刷新可用 Provider
                    </button>
                </div>

                <div className="settings-section">
                    <div className="settings-section-title">Reading Memory</div>
                    <div className="settings-row">
                        <div>
                            <div className="settings-label">Markdown 仓库</div>
                            <div className="settings-help">
                                AI 自动写入 inbox，之后交给外部 agent lint。
                            </div>
                        </div>
                        <button className="settings-primary-action" onClick={chooseReadingMemory} disabled={!isTauri || isMemoryBusy}>
                            {settings.readingMemoryPath ? '更换' : '选择'}
                        </button>
                    </div>
                    {settings.readingMemoryPath && (
                        <div className="settings-path-row">
                            <code>{settings.readingMemoryPath}</code>
                            <button onClick={openReadingMemory}>打开</button>
                        </div>
                    )}
                    <label className="settings-toggle-row">
                        <span>
                            <strong>自动摄入 inbox</strong>
                            <small>有书籍上下文的 AI 回答会无感沉淀。</small>
                        </span>
                        <input
                            type="checkbox"
                            checked={settings.readingMemoryAutoIngest}
                            onChange={event => setSettings({ ...settings, readingMemoryAutoIngest: event.target.checked })}
                        />
                    </label>
                </div>

                <div className="settings-section">
                    <div className="settings-section-title">AI 快捷提示词</div>
                    <div className="settings-quick-actions">
                        <div className="settings-quick-list">
                            <button className="settings-quick-add-main" onClick={addQuickAction}>
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
                                            className="settings-quick-hide"
                                            onClick={() => hideQuickAction(action.id)}
                                            aria-label={`隐藏 ${action.label}`}
                                        >
                                            x
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
                                            className="settings-quick-restore-btn"
                                            onClick={() => restoreQuickAction(action)}
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
                                    <button className="settings-secondary-action" onClick={resetQuickActions}>
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
                                <button className="settings-secondary-action" onClick={resetQuickActions}>
                                    恢复默认
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="settings-help settings-quick-help">AI 窗口底部最多显示前 6 个按钮，其余会进入“更多”。</div>
                </div>
            </section>
        </div>
    );
}
