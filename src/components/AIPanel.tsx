import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emit, listen } from '@tauri-apps/api/event';
import { useApp } from '../stores/AppContext';
import type { ChatMessage } from '../types';
import { AI_PANEL_WIDTH, AI_PANEL_MIN_WIDTH, AI_PANEL_MAX_WIDTH } from '../constants';
// Import from refactored modules
import {
    SendIcon, AILogoIcon, SparkleIcon, CloseIcon, TrashIcon, BookIcon,
    QuoteIcon, ChevronDownIcon, CopyIcon, CheckIcon, PopoutIcon, StopIcon,
    ExplainIcon, DeconstructIcon, InferenceIcon, TranslateIcon
} from './ai/icons';
import { FormatMessage } from './ai/MarkdownRenderer';
import type { AIProviderInfo, ChatRequest, StreamEvent } from './ai/types';
import './AIPanel.css';

// Note: Icons, Types, and FormatMessage are now imported from ./ai/ modules

// ============================================
// Main Component
// ============================================

export function AIPanel() {
    const {
        isAIPanelOpen,
        setAIPanelOpen,
        chatMessages,
        addChatMessage,
        clearChat,
        currentBook,
        currentChapterContent,
        selectedText,
        setSelectedText,
        settings,
    } = useApp();

    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');
    const [providers, setProviders] = useState<AIProviderInfo[]>([]);
    const [selectedProvider, setSelectedProvider] = useState<string>('claude');
    const [showProviderDropdown, setShowProviderDropdown] = useState(false);
    const [selectedModel, setSelectedModel] = useState<string>('sonnet');
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [isDetached, setIsDetached] = useState(false);
    const [panelWidth, setPanelWidth] = useState(AI_PANEL_WIDTH);
    const [isResizing, setIsResizing] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
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
            setPanelWidth(Math.max(AI_PANEL_MIN_WIDTH, Math.min(AI_PANEL_MAX_WIDTH, newWidth)));
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
        };
    }, [isResizing]);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages]);

    // Listen for dock request from detached window
    useEffect(() => {
        let unlisten: (() => void) | undefined;

        const setup = async () => {
            unlisten = await listen('ai-dock-request', () => {
                setIsDetached(false);
                setAIPanelOpen(true);
            });
        };

        setup();

        return () => {
            if (unlisten) unlisten();
        };
    }, [setAIPanelOpen]);

    // Listen for window ready and send context
    useEffect(() => {
        let unlisten: (() => void) | undefined;

        const setup = async () => {
            unlisten = await listen('ai-window-ready', async () => {
                // Send current context to the detached window
                await emit('ai-context-update', {
                    bookTitle: currentBook?.title,
                    selectedText: selectedText,
                    chapterContent: currentChapterContent,
                    theme: settings.theme,
                });
                // Sync chat history
                await emit('ai-chat-sync', chatMessages);
            });
        };

        setup();

        return () => {
            if (unlisten) unlisten();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only setup once

    // Push context updates to detached window when context changes
    useEffect(() => {
        if (isDetached) {
            emit('ai-context-update', {
                bookTitle: currentBook?.title,
                selectedText: selectedText,
                chapterContent: currentChapterContent,
                theme: settings.theme,
            });
        }
    }, [isDetached, currentBook?.title, selectedText, currentChapterContent, settings.theme]);

    // Sync chat history to detached window when messages change
    useEffect(() => {
        if (isDetached) {
            emit('ai-chat-sync', chatMessages);
        }
    }, [isDetached, chatMessages]);

    // Focus input when panel opens
    useEffect(() => {
        if (isAIPanelOpen && !isDetached) {
            inputRef.current?.focus();
            checkAIAvailability();
            loadSavedProvider();
        }
    }, [isAIPanelOpen, isDetached]);

    // Load saved provider from backend
    const loadSavedProvider = async () => {
        try {
            const saved = await invoke<string | null>('get_ai_provider');
            if (saved) {
                setSelectedProvider(saved);
            }
        } catch (e) {
            console.error('Failed to load saved provider:', e);
        }
    };

    // Check which AI CLIs are available
    const checkAIAvailability = async () => {
        try {
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
            console.error('Failed to check AI availability:', e);
            setProviders([]);
        }
    };

    // Refresh AI availability
    const refreshAIAvailability = async () => {
        try {
            const available = await invoke<AIProviderInfo[]>('refresh_ai_availability');
            setProviders(available);
            const firstAvailable = available.find(p => p.available);
            if (firstAvailable) {
                handleProviderChange(firstAvailable.id);
            }
        } catch (e) {
            console.error('Failed to refresh AI availability:', e);
        }
    };

    // Handle provider change
    const handleProviderChange = async (providerId: string) => {
        setSelectedProvider(providerId);
        setShowProviderDropdown(false);
        try {
            await invoke('set_ai_provider', { provider: providerId });
        } catch (e) {
            console.error('Failed to set provider:', e);
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
            console.error('Failed to copy message');
        }
    }, []);

    // Pop out AI panel to separate window
    const handlePopout = async () => {
        try {
            // Create new window for AI panel
            const aiWindow = new WebviewWindow('ai-assistant', {
                url: '/ai-window.html',
                title: 'AI Assistant',
                width: 420,
                height: 600,
                minWidth: 320,
                minHeight: 400,
                center: false,
                x: 100,
                y: 100,
                resizable: true,
                alwaysOnTop: true,
                decorations: true,
                transparent: false,
            });

            aiWindow.once('tauri://created', async () => {
                // Mark as detached and close embedded panel
                setIsDetached(true);
                setAIPanelOpen(false);

                // Give the new window time to set up its listeners, then send context
                await new Promise(resolve => setTimeout(resolve, 200));
                await emit('ai-context-update', {
                    bookTitle: currentBook?.title,
                    selectedText: selectedText,
                    chapterContent: currentChapterContent,
                    theme: settings.theme,
                });
                await emit('ai-chat-sync', chatMessages);
            });

            aiWindow.once('tauri://error', (e) => {
                console.error('Failed to create AI window:', e);
            });
        } catch (error) {
            console.error('Failed to pop out AI panel:', error);
        }
    };


    const sendMessage = async () => {
        if (!input.trim() || isLoading) return;

        // Reset cancel flag before starting
        await invoke('reset_ai_cancel');

        const userMessage: ChatMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: input.trim(),
            timestamp: Date.now(),
            context: selectedText || undefined,
        };

        addChatMessage(userMessage);
        const messageToSend = input.trim();
        setInput('');
        setIsLoading(true);
        setStreamingContent('');

        try {
            const request: ChatRequest = {
                message: messageToSend,
                context: selectedText || undefined,
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
            let streamComplete = false;

            onEvent.onmessage = (event: StreamEvent) => {
                switch (event.event) {
                    case 'started':
                        // Stream started, content will come in chunks
                        break;
                    case 'chunk':
                        fullContent += event.data.text;
                        setStreamingContent(fullContent);
                        break;
                    case 'done':
                        streamComplete = true;
                        // Add the complete message to chat history
                        const assistantMessage: ChatMessage = {
                            id: (Date.now() + 1).toString(),
                            role: 'assistant',
                            content: event.data.fullText || fullContent,
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
                        const errorMessage: ChatMessage = {
                            id: (Date.now() + 1).toString(),
                            role: 'assistant',
                            content: event.data.message,
                            timestamp: Date.now(),
                        };
                        addChatMessage(errorMessage);
                        setStreamingContent('');
                        setIsLoading(false);
                        break;
                }
            };

            // Call streaming API
            await invoke('chat_with_ai_streaming', { request, onEvent });

            // Safety check: if stream didn't complete, ensure we clean up
            if (!streamComplete && fullContent) {
                const assistantMessage: ChatMessage = {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: fullContent,
                    timestamp: Date.now(),
                };
                addChatMessage(assistantMessage);
                setStreamingContent('');
                setIsLoading(false);
            }
        } catch (error) {
            console.error('AI error:', error);
            const errorMessage: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: `Sorry, I encountered an error: ${error}\n\nPlease make sure you have one of the following AI CLIs installed and configured:\n- claude (Anthropic Claude)\n- gemini (Google Gemini)\n- openai (OpenAI)\n- droid (Factory Droid)`,
                timestamp: Date.now(),
            };
            addChatMessage(errorMessage);
            setStreamingContent('');
            setIsLoading(false);
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
            await invoke('cancel_ai_streaming');
            // Give the backend a moment to process the cancel
            // If streaming doesn't stop within 500ms, force stop on frontend
            setTimeout(() => {
                if (isLoading) {
                    // Force add the stopped message
                    const stoppedMessage: ChatMessage = {
                        id: (Date.now() + 1).toString(),
                        role: 'assistant',
                        content: streamingContent
                            ? `${streamingContent}\n\n[Generation stopped by user]`
                            : '[Generation stopped by user]',
                        timestamp: Date.now(),
                    };
                    addChatMessage(stoppedMessage);
                    setStreamingContent('');
                    setIsLoading(false);
                }
            }, 500);
        } catch (error) {
            console.error('Failed to cancel AI streaming:', error);
            // Force stop on error
            setStreamingContent('');
            setIsLoading(false);
        }
    };

    // Quick action buttons with icons - 解释、拆解、推演、翻译
    const quickActions = [
        {
            label: '解释',
            prompt: `请针对以下选取的内容进行解释：

## 要求

### 1. 数学化解释
请先用数学语言（包括集合论、逻辑符号、函数映射等）精确描述以下机制的核心要素和关系。

### 2. LEAN形式化
再用LEAN证明助手的语法，将上述机制形式化表达，包括：
- 定义相关的类型和结构
- 陈述关键定理或性质
- 提供证明思路（如适用）

请确保解释既严谨又易于理解，适当添加自然语言的说明来辅助理解形式化内容。`,
            icon: <ExplainIcon />
        },
        {
            label: '拆解',
            prompt: `请针对以下选取的内容进行知识拆解：

## 元知识分析
- **前提假设**：这段话基于哪些前提？
- **可靠性评估**：这个知识有多确定？来源可信吗？
- **忽视的脉络**：忽视了哪些重要的背景或脉络？
- **适用性判断**：这个知识在什么情境下有效？有什么边界条件？
- **反例探索**：你能提出反例吗？

## 陈述性知识
- **事实性知识**：涉及的具体事实、数据、事件
- **概念性知识**：涉及的概念、定义、分类、原理

## 程序性知识
- **技能**：蕴含的操作技能或能力
- **方法**：描述的方法论、步骤或策略

请对每个维度进行分析，若某维度不适用，请说明原因。`,
            icon: <DeconstructIcon />
        },
        {
            label: '推演',
            prompt: `请针对以下选取的内容进行多路径推演：

## 要求
使用 Inference（推理）模拟这个问题的多条可能路径：

### 1. 识别核心命题
提取内容中的核心论断或问题

### 2. 多路径推演
为每条路径提供：
- **路径名称**：简洁的描述
- **推理链**：逐步的推理过程
- **假设条件**：该路径依赖的假设
- **结论**：该路径得出的结论
- **可信度评估**：对该路径结论的可信度评分(1-10)

### 3. 路径比较
- 比较各路径的优劣
- 识别关键分歧点
- 给出综合判断

请至少提供3条不同的推理路径，展示思维的多样性和深度。`,
            icon: <InferenceIcon />
        },
        {
            label: '翻译',
            prompt: `请将以下选取的内容翻译为简体中文：

## 翻译要求
1. 确保翻译忠实于源文本，每个句子都翻译得准确流畅
2. 确保在翻译过程中不遗漏任何部分，每个细节都必须包含
3. 大数字必须按照简体中文规范正确翻译
4. 保留原文语域（Preserve the original register）

## 翻译指示
1. 仔细分析和深入理解源文本的内容、语境、情感和文化细微差别
2. 根据翻译要求将源文本准确翻译成简体中文
3. 确保翻译准确、自然、流畅，适合目标受众
4. 根据文化语言规范调整表达，但不改变原意

请直接输出翻译结果，如有必要可以在最后添加简短的译者注释。`,
            icon: <TranslateIcon />
        },
    ];

    if (!isAIPanelOpen) return null;

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
                        className="btn btn-ghost btn-icon ai-popout-btn"
                        onClick={handlePopout}
                        title="Open in separate window"
                    >
                        <PopoutIcon />
                    </button>
                    <button
                        className="btn btn-ghost btn-icon"
                        onClick={clearChat}
                        title="Clear chat"
                    >
                        <TrashIcon />
                    </button>
                    <button
                        className="btn btn-ghost btn-icon"
                        onClick={() => setAIPanelOpen(false)}
                        title="Close"
                    >
                        <CloseIcon />
                    </button>
                </div>
            </div>

            {/* Context indicator */}
            {(currentBook || selectedText) && (
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
                </div>
            )}

            <div className="ai-panel-messages">
                {chatMessages.length === 0 ? (
                    <div className="ai-panel-empty">
                        <SparkleIcon />
                        <p>Ask me anything about your book...</p>
                        {!providers.some(p => p.available) && (
                            <div className="ai-warning">
                                <p>No AI CLI detected. Please install claude, gemini, or openai CLI.</p>
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
                    chatMessages.map(msg => (
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
                    ))
                )}
                {isLoading && (
                    <div className="ai-message ai-message-assistant ai-message-streaming">
                        <div className="ai-message-content">
                            {streamingContent ? (
                                <>
                                    <FormatMessage content={streamingContent} />
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
