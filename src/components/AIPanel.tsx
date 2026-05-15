import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { useAI, useLibrary, useUI } from '../stores/AppContext';
import { isTauriRuntime } from '../utils/tauri';
import { createLogger } from '../utils/logger';
import { perfMark, perfMeasure } from '../utils/perf';
import type { ChatMessage } from '../types';
import { AI_PANEL_WIDTH, AI_PANEL_MIN_WIDTH, AI_PANEL_MAX_WIDTH } from '../constants';
// Import from refactored modules
import {
    SendIcon, AILogoIcon, SparkleIcon, TrashIcon, BookIcon,
    QuoteIcon, ChevronDownIcon, CopyIcon, CheckIcon, StopIcon,
} from './ai/icons';
import { FormatMessage } from './ai/MarkdownRenderer';
import { quickActions } from './ai/quickActions';
import type { AIProviderInfo, ChatRequest, StreamEvent } from './ai/types';
import './AIPanel.css';
import './AIPanelMarkdown.css';

const logger = createLogger('AIPanel');

// Note: Icons, Types, and FormatMessage are now imported from ./ai/ modules

// ============================================
// Main Component
// ============================================

export function AIPanel() {
    const { isAIPanelOpen } = useUI();
    const {
        chatMessages,
        addChatMessage,
        clearChat,
        currentChapterContent,
        selectedText,
        setSelectedText,
        accumulatedTexts,
        removeAccumulatedText,
        clearAccumulatedTexts,
    } = useAI();
    const { currentBook } = useLibrary();
    const isTauri = isTauriRuntime();

    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');
    const streamingContentRef = useRef('');
    const [providers, setProviders] = useState<AIProviderInfo[]>([]);
    const [selectedProvider, setSelectedProvider] = useState<string>('claude');
    const [showProviderDropdown, setShowProviderDropdown] = useState(false);
    const [selectedModel, setSelectedModel] = useState<string>('opus');
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [panelWidth, setPanelWidth] = useState(AI_PANEL_WIDTH);
    const [isResizing, setIsResizing] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const isAutoScrollEnabledRef = useRef(true);
    const scrollRafRef = useRef<number | null>(null);
    const pendingScrollBehaviorRef = useRef<ScrollBehavior>('auto');
    const pendingPanelWidthRef = useRef<number | null>(null);
    const panelWidthRafRef = useRef<number | null>(null);

    useEffect(() => {
        streamingContentRef.current = streamingContent;
    }, [streamingContent]);

    const inputRef = useRef<HTMLTextAreaElement>(null);
    const panelRef = useRef<HTMLElement>(null);

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
        isAutoScrollEnabledRef.current = distanceToBottom < 80;
    }, []);

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
        if (isAIPanelOpen) {
            inputRef.current?.focus();
            if (isTauri) {
                checkAIAvailability();
                loadSavedProvider();
            } else {
                setProviders([
                    { id: 'claude', name: 'Claude', model: 'sonnet', available: false },
                    { id: 'opencode', name: 'OpenCode', model: 'default', available: false },
                    { id: 'codex', name: 'Codex', model: 'default', available: false },
                ]);
            }
        }
    }, [isAIPanelOpen, isTauri]);

    // Load saved provider from backend
    const loadSavedProvider = async () => {
        try {
            if (!isTauri) return;
            const saved = await invoke<string | null>('get_ai_provider');
            if (saved) {
                setSelectedProvider(saved);
            }
        } catch (e) {
            logger.error('Failed to load saved provider:', e);
        }
    };

    // Check which AI CLIs are available
    const checkAIAvailability = async () => {
        try {
            if (!isTauri) return;
            const available = await invoke<AIProviderInfo[]>('check_ai_availability');
            setProviders(available);
            const currentAvailable = available.find(p => p.id === selectedProvider && p.available);
            if (!currentAvailable) {
                const firstAvailable = available.find(p => p.available);
                if (firstAvailable) {
                    handleProviderChange(firstAvailable.id);
                }
            }
        } catch (e) {
            logger.error('Failed to check AI availability:', e);
            setProviders([]);
        }
    };

    // Refresh AI availability
    const refreshAIAvailability = async () => {
        try {
            if (!isTauri) return;
            const available = await invoke<AIProviderInfo[]>('refresh_ai_availability');
            setProviders(available);
            const firstAvailable = available.find(p => p.available);
            if (firstAvailable) {
                handleProviderChange(firstAvailable.id);
            }
        } catch (e) {
            logger.error('Failed to refresh AI availability:', e);
        }
    };

    // Handle provider change
    const handleProviderChange = async (providerId: string) => {
        setSelectedProvider(providerId);
        setShowProviderDropdown(false);
        try {
            if (!isTauri) return;
            await invoke('set_ai_provider', { provider: providerId });
        } catch (e) {
            logger.error('Failed to set provider:', e);
        }
    };

    // Get current provider info
    const getCurrentProvider = () => {
        return providers.find(p => p.id === selectedProvider) || {
            id: selectedProvider,
            name: selectedProvider,
            model: '',
            available: false
        };
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

    const sendMessage = async () => {
        if (!input.trim() || isLoading) return;

        // Combine selected text and accumulated texts as context
        const allContext: string[] = [];
        if (selectedText) {
            allContext.push(selectedText);
        }
        if (accumulatedTexts.length > 0) {
            allContext.push(...accumulatedTexts);
        }
        const combinedContext = allContext.length > 0 ? allContext.join('\n\n---\n\n') : undefined;

        const userMessage: ChatMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: input.trim(),
            timestamp: Date.now(),
            context: combinedContext,
        };

        addChatMessage(userMessage);
        const messageToSend = input.trim();
        setInput('');
        setIsLoading(true);
        setStreamingContent('');
        const perfKey = `ai:sendMessage:${userMessage.id}`;
        perfMark(`${perfKey}:start`);

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

            const request: ChatRequest = {
                message: messageToSend,
                context: combinedContext,
                book_title: currentBook?.title,
                chapter_content: currentChapterContent || undefined,
                history: chatMessages.slice(-10).map(m => ({
                    role: m.role,
                    content: m.content,
                })),
                model: selectedProvider === 'claude' ? selectedModel : undefined,
            };

            // Create a channel to receive streaming events
            const onEvent = new Channel<StreamEvent>();
            let fullContent = '';
            let pendingChunks: string[] = [];
            let flushRaf: number | null = null;
            let streamComplete = false;

            const finalizeContent = () => {
                if (pendingChunks.length > 0) {
                    fullContent += pendingChunks.join('');
                    pendingChunks = [];
                }
                return fullContent;
            };

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
                        // Add the complete message to chat history
                        const assistantMessage: ChatMessage = {
                            id: (Date.now() + 1).toString(),
                            role: 'assistant',
                            content: finalContent,
                            timestamp: Date.now(),
                        };
                        addChatMessage(assistantMessage);
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
                const assistantMessage: ChatMessage = {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: finalizeContent(),
                    timestamp: Date.now(),
                };
                addChatMessage(assistantMessage);
                setStreamingContent('');
                setIsLoading(false);
            }
        } catch (error) {
            logger.error('AI error:', error);
            const errorMessage: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: `Sorry, I encountered an error: ${error}\n\nPlease make sure you have one of the following AI CLIs installed and configured:\n- claude (Anthropic Claude)\n- opencode (OpenCode)\n- codex (Codex CLI)`,
                timestamp: Date.now(),
            };
            addChatMessage(errorMessage);
            setStreamingContent('');
            setIsLoading(false);
            setInput(messageToSend);
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
                            ? `${streamingContentRef.current}\n\n[Generation stopped by user]`
                            : '[Generation stopped by user]',
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
                    <div className="ai-message-context">
                        <QuoteIcon />
                        <span>"{msg.context.slice(0, 100)}{msg.context.length > 100 ? '...' : ''}"</span>
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
                            title={copiedMessageId === msg.id ? 'Copied!' : 'Copy message'}
                        >
                            {copiedMessageId === msg.id ? <CheckIcon /> : <CopyIcon />}
                        </button>
                    </div>
                )}
            </div>
        ));
    }, [shouldRenderEmbeddedPanel, chatMessages, copiedMessageId, copyMessage]);

    if (!shouldRenderEmbeddedPanel) return null;

    return (
        <aside
            ref={panelRef}
            className={`ai-panel ${isResizing ? 'ai-panel-resizing' : ''}`}
            style={{ width: `${panelWidth}px` }}
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
                <div className="ai-panel-actions">
                    {/* AI Provider Selector */}
                    <div className="ai-provider-selector">
                        <button
                            className="ai-provider-btn"
                            onClick={() => setShowProviderDropdown(!showProviderDropdown)}
                            title="Switch AI Provider"
                        >
                            <span className={`ai-provider-dot ${getCurrentProvider().available ? 'available' : 'unavailable'}`} />
                            <span className="ai-provider-name">{getCurrentProvider().name}</span>
                            <ChevronDownIcon />
                        </button>
                        {showProviderDropdown && (
                            <div className="ai-provider-dropdown">
                                {providers.map(provider => (
                                    <button
                                        key={provider.id}
                                        className={`ai-provider-option ${provider.id === selectedProvider ? 'selected' : ''} ${!provider.available ? 'disabled' : ''}`}
                                        onClick={() => provider.available && handleProviderChange(provider.id)}
                                        disabled={!provider.available}
                                    >
                                        <span className={`ai-provider-dot ${provider.available ? 'available' : 'unavailable'}`} />
                                        <span className="ai-provider-info">
                                            <span className="ai-provider-option-name">{provider.name}</span>
                                            <span className="ai-provider-model">{provider.model}</span>
                                        </span>
                                        {provider.id === selectedProvider && <span className="ai-provider-check">v</span>}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    {isTauri && (
                        <button
                            className="btn btn-ghost btn-icon"
                            onClick={refreshAIAvailability}
                            title="Refresh AI availability"
                        >
                            ↻
                        </button>
                    )}
                    {/* Claude Model Selector - only shown when Claude is selected */}
                    {selectedProvider === 'claude' && (
                        <div className="ai-model-selector">
                            <button
                                className="ai-model-btn"
                                onClick={() => setShowModelDropdown(!showModelDropdown)}
                                title="Select Claude Model"
                            >
                                <span className="ai-model-name">{selectedModel}</span>
                                <ChevronDownIcon />
                            </button>
                            {showModelDropdown && (
                                <div className="ai-model-dropdown">
                                    {[
                                        { id: 'sonnet', name: 'Sonnet', desc: 'Fast & capable' },
                                        { id: 'opus', name: 'Opus', desc: 'Most powerful' },
                                        { id: 'haiku', name: 'Haiku', desc: 'Fastest' },
                                    ].map(model => (
                                        <button
                                            key={model.id}
                                            className={`ai-model-option ${model.id === selectedModel ? 'selected' : ''}`}
                                            onClick={() => {
                                                setSelectedModel(model.id);
                                                setShowModelDropdown(false);
                                            }}
                                        >
                                            <span className="ai-model-option-name">{model.name}</span>
                                            <span className="ai-model-option-desc">{model.desc}</span>
                                            {model.id === selectedModel && <span className="ai-model-check">v</span>}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    <button
                        className="btn btn-ghost btn-icon"
                        onClick={clearChat}
                        title="Clear chat"
                    >
                        <TrashIcon />
                    </button>
                </div>
            </div>

            {/* Context indicator */}
            {(currentBook || selectedText || accumulatedTexts.length > 0) && (
                <div className="ai-context-bar">
                    {currentBook && (
                        <div className="ai-context-item">
                            <BookIcon />
                            <span>{currentBook.title}</span>
                        </div>
                    )}
                    {selectedText && (
                        <div className="ai-context-item ai-context-quote">
                            <QuoteIcon />
                            <span>"{selectedText.slice(0, 80)}{selectedText.length > 80 ? '...' : ''}"</span>
                            <button
                                className="ai-context-clear"
                                onClick={() => setSelectedText('')}
                                title="Clear selection"
                            >
                                x
                            </button>
                        </div>
                    )}
                    {accumulatedTexts.length > 0 && (
                        <div className="ai-context-accumulated">
                            <div className="ai-accumulated-header">
                                <span className="ai-accumulated-label">Accumulated ({accumulatedTexts.length})</span>
                                <button
                                    className="ai-context-clear-all"
                                    onClick={clearAccumulatedTexts}
                                    title="Clear all accumulated texts"
                                >
                                    Clear all
                                </button>
                            </div>
                            <div className="ai-accumulated-list">
                                {accumulatedTexts.map((text, index) => (
                                    <div key={index} className="ai-accumulated-item">
                                        <span className="ai-accumulated-text">
                                            {text.slice(0, 60)}{text.length > 60 ? '...' : ''}
                                        </span>
                                        <button
                                            className="ai-context-clear"
                                            onClick={() => removeAccumulatedText(index)}
                                            title="Remove this text"
                                        >
                                            x
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
                        <SparkleIcon />
                        <p>Ask me anything about your book...</p>
                        {!providers.some(p => p.available) && (
                            <div className="ai-warning">
                                <p>No AI CLI detected. Please install claude, opencode, or codex CLI.</p>
                                <button className="btn btn-ghost btn-sm" onClick={refreshAIAvailability}>
                                    Refresh
                                </button>
                            </div>
                        )}
                        <div className="ai-panel-suggestions">
                            {quickActions.slice(0, 4).map(action => (
                                <button
                                    key={action.label}
                                    className="ai-suggestion"
                                    onClick={() => setInput(action.prompt)}
                                >
                                    {action.label}
                                </button>
                            ))}
                        </div>
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
            </div>

            {/* Quick actions bar when chatting */}
            {chatMessages.length > 0 && (
                <div className="ai-quick-actions">
                    {quickActions.map(action => (
                        <button
                            key={action.label}
                            className="ai-quick-btn"
                            onClick={() => setInput(action.prompt)}
                            disabled={isLoading}
                            title={action.prompt}
                        >
                            {action.icon}
                            <span>{action.label}</span>
                        </button>
                    ))}
                </div>
            )}

            <div className="ai-panel-input">
                <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={selectedText ? "Ask about the selected text..." : "Ask about your book..."}
                    rows={1}
                    disabled={isLoading}
                />
                {isLoading ? (
                    <button
                        className="btn btn-danger btn-icon ai-stop-btn"
                        onClick={stopGeneration}
                        title="Stop generation"
                    >
                        <StopIcon />
                    </button>
                ) : (
                    <button
                        className="btn btn-primary btn-icon"
                        onClick={sendMessage}
                        disabled={!input.trim()}
                    >
                        <SendIcon />
                    </button>
                )}
            </div>
        </aside>
    );
}
