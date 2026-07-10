import { useState, useRef, useEffect, useCallback, useMemo, memo, type SVGProps } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChatMessage as AstryxChatMessage } from '@astryxdesign/core/Chat';
import { ChatComposerInput } from '@astryxdesign/core/Chat';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { useAIStore } from '../stores/aiStore';
import { useProgressStore } from '../stores/progressStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { useSelectionStore } from '../stores/selectionStore';
import { isTauriRuntime } from '../utils/tauri';
import { handleWindowDragMouseDown } from '../utils/windowDrag';
import { createLogger } from '../utils/logger';
import type { AIProviderStatus, ChatMessage } from '../types';
import { AI_PANEL_WIDTH, AI_PANEL_MIN_WIDTH, AI_PANEL_MAX_WIDTH } from '../constants';
import {
    TrashIcon,
    QuoteIcon, CopyIcon, CheckIcon, CloseIcon,
} from './ai/icons';
import { AIComposerControls } from './ai/AIComposerControls';
import { FormatMessage } from './ai/MarkdownRenderer';
import {
    loadQuickActionConfigs,
    QUICK_ACTIONS_CHANGED_EVENT,
} from './ai/quickActions';
import { createTauriAIConversationSession } from './ai/AIConversationSession';
import type { AIConversationSessionState } from './ai/AIConversationSession';
import type { QuickActionConfig } from './ai/quickActions';
import './AIPanel.css';
import './AIPanelMarkdown.css';

const logger = createLogger('AIPanel');

function ScrollDownIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="19 12 12 19 5 12" />
        </svg>
    );
}

function HeaderBookIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
    );
}

const ChatMessageCopyButton = memo(function ChatMessageCopyButton({
    content,
}: {
    content: string;
}) {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch {
            logger.warn('Failed to copy message');
        }
    }, [content]);

    return (
        <button
            className={`ai-message-copy ${copied ? 'copied' : ''}`}
            onClick={() => { void handleCopy(); }}
            aria-label={copied ? '已复制' : '复制回答'}
        >
            {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
    );
});

const ChatMessageRow = memo(function ChatMessageRow({ message }: { message: ChatMessage }) {
    return (
        <AstryxChatMessage
            sender={message.role === 'user' ? 'user' : 'assistant'}
            className={`ai-message ai-message-${message.role}`}
        >
            {message.context && (
                <div className="ai-message-reference">
                    <QuoteIcon />
                    <span>“{message.context.slice(0, 100)}{message.context.length > 100 ? '…' : ''}”</span>
                </div>
            )}
            <div className="ai-message-content">
                {message.role === 'assistant' ? (
                    <FormatMessage content={message.content} />
                ) : (
                    message.content
                )}
            </div>
            {message.role === 'assistant' && (
                <div className="ai-message-actions">
                    <ChatMessageCopyButton content={message.content} />
                </div>
            )}
        </AstryxChatMessage>
    );
});

export function AIPanel() {
    const setAIPanelOpen = useUIStore((s) => s.setAIPanelOpen);
    const chatMessages = useAIStore((s) => s.chatMessages);
    const conversationMemory = useAIStore((s) => s.conversationMemory);
    const addChatMessage = useAIStore((s) => s.addChatMessage);
    const setConversationMemory = useAIStore((s) => s.setConversationMemory);
    const clearChat = useAIStore((s) => s.clearChat);
    const selectedText = useSelectionStore((s) => s.selectedText);
    const setSelectedText = useSelectionStore((s) => s.setSelectedText);
    const selectedCfiRange = useSelectionStore((s) => s.selectedCfiRange);
    const accumulatedTexts = useSelectionStore((s) => s.accumulatedTexts);
    const removeAccumulatedText = useSelectionStore((s) => s.removeAccumulatedText);
    const clearAccumulatedTexts = useSelectionStore((s) => s.clearAccumulatedTexts);
    const currentBook = useLibraryStore((s) => s.currentBook);
    const aiTextSize = useSettingsStore((s) => s.settings.aiTextSize);
    const aiThinkingEnabled = useSettingsStore((s) => s.settings.aiThinkingEnabled);
    const setSettings = useSettingsStore((s) => s.setSettings);
    const isTauri = isTauriRuntime();

    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');
    const [toolActivity, setToolActivity] = useState<string | null>(null);
    const streamingContentRef = useRef('');
    const [providers, setProviders] = useState<AIProviderStatus[]>([]);
    const [quickActionConfigs, setQuickActionConfigs] = useState<QuickActionConfig[]>(loadQuickActionConfigs);
    const [panelWidth, setPanelWidth] = useState(AI_PANEL_WIDTH);
    const [isResizing, setIsResizing] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const isAutoScrollEnabledRef = useRef(true);
    const scrollRafRef = useRef<number | null>(null);
    const pendingScrollBehaviorRef = useRef<ScrollBehavior>('auto');
    const pendingPanelWidthRef = useRef<number | null>(null);
    const panelWidthRafRef = useRef<number | null>(null);
    const latestMemoryRef = useRef(conversationMemory);
    // Call at send time (not render-cache): chapter/progress come from store
    // getState() so scroll without an AIPanel re-render still freezes live context.
    const readSessionStateRef = useRef<() => AIConversationSessionState>(() => {
        throw new Error('readSessionStateRef used before init');
    });

    useEffect(() => {
        streamingContentRef.current = streamingContent;
    }, [streamingContent]);

    useEffect(() => {
        latestMemoryRef.current = conversationMemory;
    }, [conversationMemory]);

    const readSessionState = useCallback((): AIConversationSessionState => {
        const ai = useAIStore.getState();
        return {
            input,
            isLoading,
            isTauri,
            chatMessages,
            conversationMemory,
            currentBook,
            bookProgressById: useProgressStore.getState().bookProgressById,
            selectedText,
            selectedCfiRange,
            accumulatedTexts,
            currentChapterContent: ai.currentChapterContent,
            currentChapterContentOffset: ai.currentChapterContentOffset,
            currentChapterSliceTruncatedEnd: ai.currentChapterSliceTruncatedEnd,
            currentChapterIndex: ai.currentChapterIndex,
            currentChapterTitle: ai.currentChapterTitle,
            settings: useSettingsStore.getState().settings,
        };
    }, [
        accumulatedTexts,
        chatMessages,
        conversationMemory,
        currentBook,
        input,
        isLoading,
        isTauri,
        selectedCfiRange,
        selectedText,
    ]);

    readSessionStateRef.current = readSessionState;

    useEffect(() => {
        const reloadQuickActions = () => setQuickActionConfigs(loadQuickActionConfigs());
        window.addEventListener(QUICK_ACTIONS_CHANGED_EVENT, reloadQuickActions);
        return () => {
            window.removeEventListener(QUICK_ACTIONS_CHANGED_EVENT, reloadQuickActions);
        };
    }, []);

    const panelRef = useRef<HTMLElement>(null);

    const visibleQuickActions = useMemo(() => quickActionConfigs.slice(0, 6), [quickActionConfigs]);
    const overflowQuickActions = useMemo(() => quickActionConfigs.slice(6), [quickActionConfigs]);

    // Handle resize drag
    const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    }, []);

    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            // Calculate width from right edge of window
            const newWidth = window.innerWidth - e.clientX;
            // Clamp between min and max width
            pendingPanelWidthRef.current = Math.max(AI_PANEL_MIN_WIDTH, Math.min(AI_PANEL_MAX_WIDTH, newWidth));
            if (panelWidthRafRef.current !== null) return;
            panelWidthRafRef.current = requestAnimationFrame(() => {
                panelWidthRafRef.current = null;
                const next = pendingPanelWidthRef.current;
                pendingPanelWidthRef.current = null;
                if (typeof next === 'number') setPanelWidth(next);
            });
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        // Add cursor style to body during resize
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            if (panelWidthRafRef.current !== null) {
                cancelAnimationFrame(panelWidthRafRef.current);
                panelWidthRafRef.current = null;
            }
        };
    }, [isResizing]);

    const scheduleScrollToBottom = useCallback((behavior: ScrollBehavior) => {
        pendingScrollBehaviorRef.current = behavior;
        if (scrollRafRef.current !== null) return;
        scrollRafRef.current = requestAnimationFrame(() => {
            scrollRafRef.current = null;
            messagesEndRef.current?.scrollIntoView({ behavior: pendingScrollBehaviorRef.current });
        });
    }, []);

    const handleMessagesScroll = useCallback(() => {
        const el = messagesContainerRef.current;
        if (!el) return;
        const distanceToBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
        const pinned = distanceToBottom < 80;
        isAutoScrollEnabledRef.current = pinned;
        setIsPinnedToBottom(pinned);
    }, []);

    // Show a "jump to latest" affordance when the user has scrolled up.
    const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);

    const scrollToLatest = useCallback(() => {
        isAutoScrollEnabledRef.current = true;
        setIsPinnedToBottom(true);
        scheduleScrollToBottom('smooth');
    }, [scheduleScrollToBottom]);

    useEffect(() => {
        if (!isAutoScrollEnabledRef.current) return;
        scheduleScrollToBottom('auto');
    }, [chatMessages, scheduleScrollToBottom]);

    useEffect(() => {
        if (!isAutoScrollEnabledRef.current) return;
        if (!isLoading) return;
        if (!streamingContent) return;
        scheduleScrollToBottom('auto');
    }, [isLoading, streamingContent, scheduleScrollToBottom]);

    useEffect(() => {
        return () => {
            if (scrollRafRef.current !== null) {
                cancelAnimationFrame(scrollRafRef.current);
                scrollRafRef.current = null;
            }
        };
    }, []);

    const refreshProviders = useCallback(async () => {
        try {
            if (!isTauri) return;
            const available = await invoke<AIProviderStatus[]>('list_ai_providers');
            setProviders(available);
        } catch (e) {
            logger.error('Failed to load AI providers:', e);
            setProviders([]);
        }
    }, [isTauri]);

    const handleSelectProvider = useCallback(async (providerId: string) => {
        try {
            if (!isTauri) return;
            await invoke('set_active_ai_provider', { id: providerId });
            await refreshProviders();
        } catch (e) {
            logger.error('Failed to switch AI provider:', e);
        }
    }, [isTauri, refreshProviders]);

    const handleThinkingEnabledChange = useCallback((enabled: boolean) => {
        setSettings({
            ...useSettingsStore.getState().settings,
            aiThinkingEnabled: enabled,
        });
    }, [setSettings]);

    // Focus input when panel opens
    useEffect(() => {
        if (isTauri) {
            void refreshProviders();
        }
    }, [isTauri, refreshProviders]);

    const startNewSession = async () => {
        clearChat();
        setInput('');
        setStreamingContent('');
        setToolActivity(null);
        setSelectedText('');
        clearAccumulatedTexts();
        await refreshProviders();
    };

    const session = useMemo(() => createTauriAIConversationSession({
        getState: () => readSessionStateRef.current(),
        getLatestConversationMemory: () => latestMemoryRef.current,
        setLatestConversationMemory: (memory) => {
            latestMemoryRef.current = memory;
        },
        addChatMessage,
        setConversationMemory,
        setInput,
        setIsLoading,
        setStreamingContent,
        getStreamingContent: () => streamingContentRef.current,
        setToolActivity,
        clearSelectedText: () => setSelectedText(''),
    }), [
        addChatMessage,
        setConversationMemory,
        setSelectedText,
    ]);

    const sendMessage = useCallback((overrideText?: string) => session.send(overrideText), [session]);
    const stopGeneration = useCallback(() => session.stop(), [session]);

    useEffect(() => () => {
        session.stop();
    }, [session]);

    const renderedMessages = useMemo(
        () => chatMessages.map(msg => (
            <ChatMessageRow key={msg.id} message={msg} />
        )),
        [chatMessages],
    );

    const quickActionControls = (
        <div className="ai-margin-actions">
            {visibleQuickActions.map(action => (
                <Button
                    key={action.id}
                    className="ai-margin-action"
                    variant="ghost"
                    size="sm"
                    label={action.label}
                    isDisabled={isLoading}
                    onClick={() => setInput(action.prompt)}
                />
            ))}
            {overflowQuickActions.length > 0 && (
                <MoreMenu
                    className="ai-margin-more"
                    label="更多旁注动作"
                    size="sm"
                    isDisabled={isLoading}
                    items={overflowQuickActions.map(action => ({
                        label: action.label,
                        onClick: () => setInput(action.prompt),
                    }))}
                />
            )}
        </div>
    );

    return (
        <aside
            ref={panelRef}
            className={`ai-panel ${isResizing ? 'ai-panel-resizing' : ''}`}
            style={{
                width: `${panelWidth}px`,
                '--ai-text-size': `${aiTextSize}px`,
            } as React.CSSProperties}
        >
            {/* Resize handle */}
            <div
                className="ai-panel-resize-handle"
                onMouseDown={handleResizeMouseDown}
            />
            <div className="ai-panel-header" onMouseDown={handleWindowDragMouseDown}>
                <div className="ai-panel-current-book">
                    {currentBook && (
                        <>
                            <Icon icon={HeaderBookIcon} size="sm" color="accent" />
                            <span>{currentBook.title}</span>
                        </>
                    )}
                </div>
                <div className="ai-panel-actions">
                    <button
                        className="btn btn-ghost btn-icon"
                        onClick={startNewSession}
                        aria-label="新会话"
                        disabled={isLoading}
                    >
                        <TrashIcon />
                    </button>
                    <button
                        className="btn btn-ghost btn-icon"
                        onClick={() => setAIPanelOpen(false)}
                        aria-label="关闭 AI 面板"
                    >
                        <CloseIcon />
                    </button>
                </div>
            </div>

            {/* Source indicator */}
            {(selectedText || accumulatedTexts.length > 0) && (
                <div className="ai-source-bar">
                    {selectedText && (
                        <div className="ai-source-item ai-source-quote">
                            <QuoteIcon />
                            <span>“{selectedText.slice(0, 80)}{selectedText.length > 80 ? '…' : ''}”</span>
                            <button
                                className="ai-source-clear"
                                onClick={() => setSelectedText('')}
                                aria-label="清除选区"
                            >
                                <CloseIcon />
                            </button>
                        </div>
                    )}
                    {accumulatedTexts.length > 0 && (
                        <div className="ai-source-stack">
                            <div className="ai-source-stack-header">
                                <span className="ai-source-stack-label">多段引用 ({accumulatedTexts.length})</span>
                                <button
                                    className="ai-source-clear-all"
                                    onClick={clearAccumulatedTexts}
                                >
                                    清空
                                </button>
                            </div>
                            <div className="ai-source-stack-list">
                                {accumulatedTexts.map((text, index) => (
                                    <div key={index} className="ai-source-stack-item">
                                        <span className="ai-source-stack-text">
                                            {text.slice(0, 60)}{text.length > 60 ? '…' : ''}
                                        </span>
                                        <button
                                            className="ai-source-clear"
                                            onClick={() => removeAccumulatedText(index)}
                                            aria-label="移除这段文本"
                                        >
                                            <CloseIcon />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="ai-panel-messages" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
                {chatMessages.length === 0 ? (
                    <div className="ai-panel-empty">
                        {!providers.some(p => p.active && p.hasKey) ? (
                            <div className="ai-warning">
                                <p>尚未配置可用的 AI 服务。请在设置中添加一个 OpenAI 兼容服务并填入 API Key。</p>
                                <button className="btn btn-ghost btn-sm" onClick={refreshProviders}>
                                    刷新
                                </button>
                            </div>
                        ) : (
                            null
                        )}
                    </div>
                ) : (
                    renderedMessages
                )}
                {isLoading && (
                    <AstryxChatMessage
                        sender="assistant"
                        className="ai-message ai-message-assistant ai-message-streaming"
                    >
                        <div className="ai-message-content">
                            {toolActivity && (
                                <div
                                    className="ai-tool-activity"
                                    role="status"
                                    aria-live="polite"
                                    aria-atomic="true"
                                >
                                    {toolActivity}
                                </div>
                            )}
                            {streamingContent ? (
                                <>
                                    <pre className="ai-streaming-text">{streamingContent}</pre>
                                    <span className="streaming-cursor">|</span>
                                </>
                            ) : (
                                <div className="ai-loading">
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                </div>
                            )}
                        </div>
                    </AstryxChatMessage>
                )}
                <div ref={messagesEndRef} />

                {chatMessages.length > 0 && !isPinnedToBottom && (
                    <button
                        className="ai-scroll-to-latest"
                        onClick={scrollToLatest}
                        aria-label="回到底部"
                    >
                        <ScrollDownIcon />
                    </button>
                )}
            </div>

            {quickActionControls}

            <div className="ai-panel-input">
                <div className="ai-composer-shell">
                    <ChatComposerInput
                        value={input}
                        onChange={setInput}
                        onSubmit={(text) => { void sendMessage(text); }}
                        placeholder=""
                        label="AI 输入"
                        maxRows={4}
                        isDisabled={isLoading}
                        className="ai-composer-input"
                    />
                    <AIComposerControls
                        providers={providers}
                        isLoading={isLoading}
                        canSend={Boolean(input.trim())}
                        thinkingEnabled={aiThinkingEnabled}
                        onThinkingEnabledChange={handleThinkingEnabledChange}
                        onSelectProvider={(providerId) => { void handleSelectProvider(providerId); }}
                        onSend={() => { void sendMessage(); }}
                        onStop={stopGeneration}
                    />
                </div>
            </div>
        </aside>
    );
}
