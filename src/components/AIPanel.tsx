import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChatMessage as AstryxChatMessage } from '@astryxdesign/core/Chat';
import { ChatComposerInput } from '@astryxdesign/core/Chat';
import { ChatSendButton } from '@astryxdesign/core/Chat';
import { Button } from '@astryxdesign/core/Button';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { useAIStore } from '../stores/aiStore';
import { useProgressStore } from '../stores/progressStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { useSelectionStore } from '../stores/selectionStore';
import { isTauriRuntime } from '../utils/tauri';
import { createLogger } from '../utils/logger';
import type { AIProviderStatus } from '../types';
import { AI_PANEL_WIDTH, AI_PANEL_MIN_WIDTH, AI_PANEL_MAX_WIDTH } from '../constants';
import {
    SendIcon, AILogoIcon, TrashIcon, BookIcon,
    QuoteIcon, CopyIcon, CheckIcon, StopIcon, CloseIcon,
} from './ai/icons';
import { FormatMessage } from './ai/MarkdownRenderer';
import {
    hydrateQuickActions,
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

export function AIPanel() {
    const isAIPanelOpen = useUIStore((s) => s.isAIPanelOpen);
    const chatMessages = useAIStore((s) => s.chatMessages);
    const conversationMemory = useAIStore((s) => s.conversationMemory);
    const addChatMessage = useAIStore((s) => s.addChatMessage);
    const setConversationMemory = useAIStore((s) => s.setConversationMemory);
    const clearChat = useAIStore((s) => s.clearChat);
    const currentChapterContent = useAIStore((s) => s.currentChapterContent);
    const selectedText = useSelectionStore((s) => s.selectedText);
    const setSelectedText = useSelectionStore((s) => s.setSelectedText);
    const selectedCfiRange = useSelectionStore((s) => s.selectedCfiRange);
    const accumulatedTexts = useSelectionStore((s) => s.accumulatedTexts);
    const removeAccumulatedText = useSelectionStore((s) => s.removeAccumulatedText);
    const clearAccumulatedTexts = useSelectionStore((s) => s.clearAccumulatedTexts);
    const currentBook = useLibraryStore((s) => s.currentBook);
    const bookProgressById = useProgressStore((s) => s.bookProgressById);
    const settings = useSettingsStore((s) => s.settings);
    const isTauri = isTauriRuntime();

    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');
    const streamingContentRef = useRef('');
    const [providers, setProviders] = useState<AIProviderStatus[]>([]);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
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
    const sessionStateRef = useRef<AIConversationSessionState | null>(null);

    useEffect(() => {
        streamingContentRef.current = streamingContent;
    }, [streamingContent]);

    useEffect(() => {
        latestMemoryRef.current = conversationMemory;
    }, [conversationMemory]);

    sessionStateRef.current = {
        input,
        isLoading,
        isTauri,
        chatMessages,
        conversationMemory,
        currentBook,
        bookProgressById,
        selectedText,
        selectedCfiRange,
        accumulatedTexts,
        currentChapterContent,
        settings,
    };

    useEffect(() => {
        const reloadQuickActions = () => setQuickActionConfigs(loadQuickActionConfigs());
        window.addEventListener(QUICK_ACTIONS_CHANGED_EVENT, reloadQuickActions);
        window.addEventListener('storage', reloadQuickActions);
        return () => {
            window.removeEventListener(QUICK_ACTIONS_CHANGED_EVENT, reloadQuickActions);
            window.removeEventListener('storage', reloadQuickActions);
        };
    }, []);

    const panelRef = useRef<HTMLElement>(null);

    const quickActions = useMemo(() => hydrateQuickActions(quickActionConfigs), [quickActionConfigs]);
    const visibleQuickActions = useMemo(() => quickActions.slice(0, 6), [quickActions]);
    const overflowQuickActions = useMemo(() => quickActions.slice(6), [quickActions]);

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

    // Focus input when panel opens
    useEffect(() => {
        if (isAIPanelOpen && isTauri) {
            void refreshProviders();
        }
    }, [isAIPanelOpen, isTauri, refreshProviders]);

    // Copy message content
    const copyMessage = useCallback(async (messageId: string, content: string) => {
        try {
            await navigator.clipboard.writeText(content);
            setCopiedMessageId(messageId);
            setTimeout(() => setCopiedMessageId(null), 2000);
        } catch {
            logger.warn('Failed to copy message');
        }
    }, []);

    const startNewSession = async () => {
        clearChat();
        setInput('');
        setStreamingContent('');
        setSelectedText('');
        clearAccumulatedTexts();
        await refreshProviders();
    };

    const session = useMemo(() => createTauriAIConversationSession({
        getState: () => sessionStateRef.current!,
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
        clearSelectedText: () => setSelectedText(''),
    }), [
        addChatMessage,
        setConversationMemory,
        setSelectedText,
    ]);

    const sendMessage = useCallback((overrideText?: string) => session.send(overrideText), [session]);
    const stopGeneration = useCallback(() => session.stop(), [session]);

    // Note: We still mount and run hooks while detached so the
    // window-bridge sync effects keep working. The actual embedded UI is
    // conditionally rendered at the end of the component.
    const shouldRenderEmbeddedPanel = isAIPanelOpen;

    const renderedMessages = useMemo(() => {
        if (!shouldRenderEmbeddedPanel) return null;
        return chatMessages.map(msg => (
            <AstryxChatMessage
                key={msg.id}
                sender={msg.role === 'user' ? 'user' : 'assistant'}
                className={`ai-message ai-message-${msg.role}`}
            >
                {msg.context && (
                    <div className="ai-message-reference">
                        <QuoteIcon />
                        <span>“{msg.context.slice(0, 100)}{msg.context.length > 100 ? '…' : ''}”</span>
                    </div>
                )}
                <div className="ai-message-content">
                    {msg.role === 'assistant' ? (
                        <FormatMessage content={msg.content} />
                    ) : (
                        msg.content
                    )}
                </div>
                {msg.role === 'assistant' && (
                    <div className="ai-message-actions">
                        <button
                            className={`ai-message-copy ${copiedMessageId === msg.id ? 'copied' : ''}`}
                            onClick={() => copyMessage(msg.id, msg.content)}
                            aria-label={copiedMessageId === msg.id ? '已复制' : '复制回答'}
                        >
                            {copiedMessageId === msg.id ? <CheckIcon /> : <CopyIcon />}
                        </button>
                    </div>
                )}
            </AstryxChatMessage>
        ));
    }, [shouldRenderEmbeddedPanel, chatMessages, copiedMessageId, copyMessage]);

    const quickActionControls = (
        <div className="ai-margin-actions">
            {visibleQuickActions.map(action => (
                <Button
                    key={action.id}
                    className="ai-margin-action"
                    variant="ghost"
                    size="sm"
                    label={action.label}
                    icon={action.icon}
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
                        icon: action.icon,
                        onClick: () => setInput(action.prompt),
                    }))}
                />
            )}
        </div>
    );

    if (!shouldRenderEmbeddedPanel) return null;

    return (
        <aside
            ref={panelRef}
            className={`ai-panel ${isResizing ? 'ai-panel-resizing' : ''}`}
            style={{
                width: `${panelWidth}px`,
                '--ai-text-size': `${settings.aiTextSize}px`,
            } as React.CSSProperties}
        >
            {/* Resize handle */}
            <div
                className="ai-panel-resize-handle"
                onMouseDown={handleResizeMouseDown}
            />
            <div className="ai-panel-header">
                <div className="ai-panel-title">
                    <AILogoIcon size={28} />
                </div>
                <div className="ai-panel-motto">原本山川&nbsp;&nbsp;极命草木</div>
                <div className="ai-panel-actions">
                    <button
                        className="btn btn-ghost btn-icon"
                        onClick={startNewSession}
                        aria-label="新会话"
                        disabled={isLoading}
                    >
                        <TrashIcon />
                    </button>
                </div>
            </div>

            {/* Source indicator */}
            {(currentBook || selectedText || accumulatedTexts.length > 0) && (
                <div className="ai-source-bar">
                    {currentBook && (
                        <div className="ai-source-item">
                            <BookIcon />
                            <span>{currentBook.title}</span>
                        </div>
                    )}
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
                <ChatSendButton
                    isStopShown={isLoading}
                    isDisabled={!isLoading && !input.trim()}
                    onSend={() => { void sendMessage(); }}
                    onStop={stopGeneration}
                    sendIcon={<SendIcon />}
                    stopIcon={<StopIcon />}
                />
            </div>
        </aside>
    );
}
