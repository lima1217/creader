import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { useAI, useBookProgress, useLibrary, useSettings, useUI } from '../stores/AppContext';
import { isTauriRuntime } from '../utils/tauri';
import { createLogger } from '../utils/logger';
import { perfMark, perfMeasure } from '../utils/perf';
import { buildReadingMemoryIngestInput, ingestReadingMemoryDirect } from '../services/ReadingMemory';
import type { ChatMessage } from '../types';
import { AI_PANEL_WIDTH, AI_PANEL_MIN_WIDTH, AI_PANEL_MAX_WIDTH } from '../constants';
// Import from refactored modules
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
import { buildChatRequest, buildContextFromReadingSnapshot, createUserChatMessage } from '../domain/aiRequest';
import { buildReadingContextSnapshot } from '../domain/readingSource';
import type { ReadingContextSnapshot } from '../domain/readingSource';
import { getMessagesToSummarize } from './ai/conversationMemory';
import { createOnceCommitter } from './ai/streamCommit';
import type { QuickActionConfig } from './ai/quickActions';
import type { AIProviderStatus, ChatRequest, StreamEvent, SummarizeConversationRequest } from './ai/types';
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

// Note: Icons, Types, and FormatMessage are now imported from ./ai/ modules

// ============================================
// Main Component
// ============================================

export function AIPanel() {
    const { isAIPanelOpen } = useUI();
    const {
        chatMessages,
        conversationMemory,
        addChatMessage,
        setConversationMemory,
        clearChat,
        currentChapterContent,
        selectedText,
        setSelectedText,
        selectedCfiRange,
        accumulatedTexts,
        removeAccumulatedText,
        clearAccumulatedTexts,
    } = useAI();
    const { currentBook } = useLibrary();
    const { bookProgressById } = useBookProgress();
    const { settings } = useSettings();
    const isTauri = isTauriRuntime();

    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');
    const streamingContentRef = useRef('');
    const [providers, setProviders] = useState<AIProviderStatus[]>([]);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [quickActionConfigs, setQuickActionConfigs] = useState<QuickActionConfig[]>(loadQuickActionConfigs);
    const [showQuickActionOverflow, setShowQuickActionOverflow] = useState(false);
    const [panelWidth, setPanelWidth] = useState(AI_PANEL_WIDTH);
    const [isResizing, setIsResizing] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const isAutoScrollEnabledRef = useRef(true);
    const scrollRafRef = useRef<number | null>(null);
    const pendingScrollBehaviorRef = useRef<ScrollBehavior>('auto');
    const pendingPanelWidthRef = useRef<number | null>(null);
    const panelWidthRafRef = useRef<number | null>(null);
    const isSendingRef = useRef(false);
    const latestMemoryRef = useRef(conversationMemory);

    useEffect(() => {
        streamingContentRef.current = streamingContent;
    }, [streamingContent]);

    useEffect(() => {
        latestMemoryRef.current = conversationMemory;
    }, [conversationMemory]);

    useEffect(() => {
        const reloadQuickActions = () => setQuickActionConfigs(loadQuickActionConfigs());
        window.addEventListener(QUICK_ACTIONS_CHANGED_EVENT, reloadQuickActions);
        window.addEventListener('storage', reloadQuickActions);
        return () => {
            window.removeEventListener(QUICK_ACTIONS_CHANGED_EVENT, reloadQuickActions);
            window.removeEventListener('storage', reloadQuickActions);
        };
    }, []);

    const inputRef = useRef<HTMLTextAreaElement>(null);
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

    // Focus input when panel opens
    useEffect(() => {
        if (isAIPanelOpen && isTauri) {
            checkAIAvailability();
        }
    }, [isAIPanelOpen, isTauri]);

    // Load configured OpenAI-compatible providers and their key status.
    const checkAIAvailability = async () => {
        try {
            if (!isTauri) return;
            const available = await invoke<AIProviderStatus[]>('list_ai_providers');
            setProviders(available);
        } catch (e) {
            logger.error('Failed to load AI providers:', e);
            setProviders([]);
        }
    };

    // Refresh provider list (used after settings changes).
    const refreshAIAvailability = async () => {
        try {
            if (!isTauri) return;
            const available = await invoke<AIProviderStatus[]>('list_ai_providers');
            setProviders(available);
        } catch (e) {
            logger.error('Failed to refresh AI providers:', e);
        }
    };

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
        await refreshAIAvailability();
    };

    const autoIngestReadingMemory = useCallback(async (
        userMessage: ChatMessage,
        assistantMessage: ChatMessage,
        readingContext: ReadingContextSnapshot,
    ) => {
        if (!isTauri) return;
        if (!settings.readingMemoryAutoIngest || !settings.readingMemoryPath || !readingContext.book) return;

        try {
            const ingestInput = buildReadingMemoryIngestInput({
                rootPath: settings.readingMemoryPath,
                readingContext,
                userMessage,
                assistantMessage,
            });
            if (!ingestInput) return;

            // The active provider/model is resolved by the backend.
            await ingestReadingMemoryDirect(ingestInput);
        } catch (error) {
            logger.warn('Reading Memory ingest skipped:', error);
        }
    }, [
        isTauri,
        settings.readingMemoryAutoIngest,
        settings.readingMemoryPath,
    ]);

    const ensureConversationMemory = useCallback(async (): Promise<string | undefined> => {
        if (!settings.aiAutoSummarize || !isTauri || chatMessages.length <= settings.aiContextWindow) {
            return conversationMemory?.summary;
        }

        const activeMemory = latestMemoryRef.current;
        if (activeMemory?.bookId && currentBook?.id && activeMemory.bookId !== currentBook.id) {
            return undefined;
        }

        const eligibleMessages = getMessagesToSummarize(chatMessages, settings.aiContextWindow, activeMemory);

        if (eligibleMessages.length < Math.min(10, settings.aiContextWindow)) {
            return activeMemory?.summary;
        }

        const lastFolded = eligibleMessages[eligibleMessages.length - 1];
        const request: SummarizeConversationRequest = {
            existing_summary: activeMemory?.summary,
            messages: eligibleMessages.map(message => ({
                role: message.role,
                content: message.content,
            })),
            book_title: currentBook?.title,
        };

        try {
            const summary = await invoke<string>('summarize_ai_conversation', { request });
            const trimmedSummary = summary.trim();
            if (!trimmedSummary) return activeMemory?.summary;

            const nextMemory = {
                id: activeMemory?.id ?? 'active',
                bookId: currentBook?.id,
                bookTitle: currentBook?.title,
                summary: trimmedSummary,
                summarizedThroughMessageId: lastFolded.id,
                summarizedThroughTimestamp: lastFolded.timestamp,
                updatedAt: Date.now(),
            };
            latestMemoryRef.current = nextMemory;
            setConversationMemory(nextMemory);
            return trimmedSummary;
        } catch (error) {
            logger.warn('Conversation summary skipped:', error);
            return activeMemory?.summary;
        }
    }, [
        chatMessages,
        conversationMemory,
        currentBook,
        isTauri,
        setConversationMemory,
        settings.aiAutoSummarize,
        settings.aiContextWindow,
    ]);

    const sendMessage = async () => {
        if (!input.trim() || isLoading || isSendingRef.current) return;
        isSendingRef.current = true;

        const readingContext = buildReadingContextSnapshot({
            book: currentBook,
            progress: currentBook ? bookProgressById[currentBook.id] || currentBook.progress : undefined,
            selectedText,
            selectedCfiRange,
            accumulatedTexts,
            chapterContent: currentChapterContent,
        });
        const { combinedContext } = buildContextFromReadingSnapshot(readingContext);
        const userMessageTimestamp = Date.now();

        const userMessage = createUserChatMessage({
            id: userMessageTimestamp.toString(),
            content: input.trim(),
            timestamp: userMessageTimestamp,
            context: combinedContext,
            contextCfi: readingContext.selection?.cfiRange,
        });

        addChatMessage(userMessage);
        const messageToSend = input.trim();
        setInput('');
        setIsLoading(true);
        setStreamingContent('');
        const perfKey = `ai:sendMessage:${userMessage.id}`;
        perfMark(`${perfKey}:start`);
        let streamComplete = false;

        try {
            if (!isTauri) {
                const assistantMessage: ChatMessage = {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: `（Web 预览模式）你发送了：\n\n${messageToSend}\n\n可以直接选中这段文字验证选中高亮效果。`,
                    timestamp: Date.now(),
                };
                addChatMessage(assistantMessage);
                setIsLoading(false);
                return;
            }

            await invoke('reset_ai_cancel');
            const conversationSummary = await ensureConversationMemory();

            const request: ChatRequest = buildChatRequest({
                message: messageToSend,
                readingContext,
                conversationSummary,
                chatMessages,
                settings,
            });

            // Create a channel to receive streaming events
            const onEvent = new Channel<StreamEvent>();
            let fullContent = '';
            let pendingChunks: string[] = [];
            let flushRaf: number | null = null;

            const finalizeContent = () => {
                if (pendingChunks.length > 0) {
                    fullContent += pendingChunks.join('');
                    pendingChunks = [];
                }
                return fullContent;
            };

            const commitAssistantMessage = createOnceCommitter((content: string) => {
                const assistantMessage: ChatMessage = {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content,
                    timestamp: Date.now(),
                };
                addChatMessage(assistantMessage);
                void autoIngestReadingMemory(userMessage, assistantMessage, readingContext);
            });

            const scheduleFlush = () => {
                if (flushRaf !== null) return;
                flushRaf = requestAnimationFrame(() => {
                    flushRaf = null;
                    setStreamingContent(finalizeContent());
                });
            };

            onEvent.onmessage = (event: StreamEvent) => {
                switch (event.event) {
                    case 'started':
                        // Stream started, content will come in chunks
                        break;
                    case 'chunk':
                        pendingChunks.push(event.data.text);
                        scheduleFlush();
                        break;
                    case 'done':
                        streamComplete = true;
                        if (flushRaf !== null) {
                            cancelAnimationFrame(flushRaf);
                            flushRaf = null;
                        }
                        perfMeasure(perfKey, `${perfKey}:start`, `${perfKey}:done`);
                        const finalContent = event.data.fullText || finalizeContent();
                        commitAssistantMessage(finalContent);
                        setStreamingContent('');
                        setIsLoading(false);
                        if (selectedText) {
                            setSelectedText('');
                        }
                        break;
                    case 'error':
                        streamComplete = true;
                        if (flushRaf !== null) {
                            cancelAnimationFrame(flushRaf);
                            flushRaf = null;
                        }
                        perfMeasure(perfKey, `${perfKey}:start`, `${perfKey}:error`);
                        const providerPrefix = event.data.provider ? `[${event.data.provider}] ` : '';
                        const errorMessage: ChatMessage = {
                            id: (Date.now() + 1).toString(),
                            role: 'assistant',
                            content: `${providerPrefix}${event.data.message}`,
                            timestamp: Date.now(),
                        };
                        addChatMessage(errorMessage);
                        setStreamingContent('');
                        setIsLoading(false);
                        setInput(messageToSend);
                        break;
                }
            };

            // Call streaming API
            await invoke('chat_with_ai_streaming', { request, onEvent });

            // Safety check: if stream didn't complete, ensure we clean up
            if (!streamComplete && (fullContent || pendingChunks.length > 0)) {
                perfMeasure(perfKey, `${perfKey}:start`, `${perfKey}:fallback`);
                commitAssistantMessage(finalizeContent());
                setStreamingContent('');
                setIsLoading(false);
            }
        } catch (error) {
            logger.error('AI error:', error);
            if (streamComplete) return;
            const errorMessage: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: `AI 请求失败：${error}`,
                timestamp: Date.now(),
            };
            addChatMessage(errorMessage);
            setStreamingContent('');
            setIsLoading(false);
            setInput(messageToSend);
        } finally {
            isSendingRef.current = false;
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };


    // Stop AI generation
    const stopGeneration = async () => {
        try {
            if (!isTauri) {
                setStreamingContent('');
                setIsLoading(false);
                return;
            }
            await invoke('cancel_ai_streaming');
            // Give the backend a moment to process the cancel
            // If streaming doesn't stop within 500ms, force stop on frontend
            setTimeout(() => {
                if (isLoading) {
                    // Force add the stopped message
                    const stoppedMessage: ChatMessage = {
                        id: (Date.now() + 1).toString(),
                        role: 'assistant',
                        content: streamingContentRef.current
                            ? `${streamingContentRef.current}\n\n[已停止生成]`
                            : '[已停止生成]',
                        timestamp: Date.now(),
                    };
                    addChatMessage(stoppedMessage);
                    setStreamingContent('');
                    setIsLoading(false);
                }
            }, 500);
        } catch (error) {
            logger.error('Failed to cancel AI streaming:', error);
            // Force stop on error
            setStreamingContent('');
            setIsLoading(false);
        }
    };

    // Note: We still mount and run hooks while detached so the
    // window-bridge sync effects keep working. The actual embedded UI is
    // conditionally rendered at the end of the component.
    const shouldRenderEmbeddedPanel = isAIPanelOpen;

    const renderedMessages = useMemo(() => {
        if (!shouldRenderEmbeddedPanel) return null;
        return chatMessages.map(msg => (
            <div key={msg.id} className={`ai-message ai-message-${msg.role}`}>
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
                            title={copiedMessageId === msg.id ? '已复制' : '复制回答'}
                        >
                            {copiedMessageId === msg.id ? <CheckIcon /> : <CopyIcon />}
                        </button>
                    </div>
                )}
            </div>
        ));
    }, [shouldRenderEmbeddedPanel, chatMessages, copiedMessageId, copyMessage]);

    const quickActionControls = (
        <>
            <div className="ai-margin-actions">
                {visibleQuickActions.map(action => (
                    <button
                        key={action.id}
                        className="ai-margin-action"
                        onClick={() => setInput(action.prompt)}
                        disabled={isLoading}
                    >
                        {action.icon}
                        <span>{action.label}</span>
                    </button>
                ))}
                {overflowQuickActions.length > 0 && (
                    <button
                        className={`ai-margin-action ai-margin-more ${showQuickActionOverflow ? 'active' : ''}`}
                        onClick={() => setShowQuickActionOverflow(open => !open)}
                        disabled={isLoading}
                        aria-label="更多旁注动作"
                    >
                        <span>更多</span>
                    </button>
                )}
                {showQuickActionOverflow && overflowQuickActions.length > 0 && (
                    <div className="ai-margin-overflow">
                        {overflowQuickActions.map(action => (
                            <button
                                key={action.id}
                                className="ai-margin-overflow-btn"
                                onClick={() => {
                                    setInput(action.prompt);
                                    setShowQuickActionOverflow(false);
                                }}
                                disabled={isLoading}
                            >
                                {action.icon}
                                <span>{action.label}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </>
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
                        title="新会话"
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
                                title="清除选区"
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
                                    title="清除所有累积文本"
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
                                            title="移除这段文本"
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
                                <button className="btn btn-ghost btn-sm" onClick={refreshAIAvailability}>
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
                    <div className="ai-message ai-message-assistant ai-message-streaming">
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
                    </div>
                )}
                <div ref={messagesEndRef} />

                {chatMessages.length > 0 && !isPinnedToBottom && (
                    <button
                        className="ai-scroll-to-latest"
                        onClick={scrollToLatest}
                        title="回到底部"
                        aria-label="回到底部"
                    >
                        <ScrollDownIcon />
                    </button>
                )}
            </div>

            {quickActionControls}

            <div className="ai-panel-input">
                <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="提问，或选中正文后问 AI…"
                    rows={1}
                    disabled={isLoading}
                />
                {isLoading ? (
                    <button
                        className="btn btn-danger btn-icon ai-stop-btn"
                        onClick={stopGeneration}
                        title="停止生成"
                    >
                        <StopIcon />
                    </button>
                ) : (
                    <button
                        className="btn btn-primary btn-icon"
                        onClick={sendMessage}
                        disabled={!input.trim()}
                        title="发送（Enter）"
                    >
                        <SendIcon />
                    </button>
                )}
            </div>
        </aside>
    );
}
