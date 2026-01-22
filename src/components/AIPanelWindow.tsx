import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { ChatMessage } from '../types';
import './AIPanel.css';

// Re-export icons from AIPanel (simplified for the standalone window)
const SendIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
);

const AILogoIcon = ({ size = 20 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="ai-logo-icon">
        <circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.9" />
        <ellipse cx="12" cy="12" rx="8" ry="4" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.6" />
        <ellipse cx="12" cy="12" rx="8" ry="4" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.6" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="12" rx="8" ry="4" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.6" transform="rotate(120 12 12)" />
        <circle cx="4" cy="12" r="1.5" fill="currentColor" opacity="0.7" />
        <circle cx="20" cy="12" r="1.5" fill="currentColor" opacity="0.7" />
        <circle cx="12" cy="4" r="1.5" fill="currentColor" opacity="0.7" />
        <circle cx="12" cy="20" r="1.5" fill="currentColor" opacity="0.7" />
    </svg>
);

const DockIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="15" y1="3" x2="15" y2="21" />
        <polyline points="10 12 6 12" />
        <polyline points="10 8 6 12 10 16" />
    </svg>
);

const TrashIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
);

const SparkleIcon = () => (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
        <path d="M5 19l1 3 1-3 3-1-3-1-1-3-1 3-3 1 3 1z" />
        <path d="M19 12l1 2 1-2 2-1-2-1-1-2-1 2-2 1 2 1z" />
    </svg>
);

const CopyIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
);

const CheckIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

// Stop Icon for cancelling AI generation
const StopIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
);

// Quick Action Icons

// Explain Icon - Mathematical/Formal explanation
const ExplainIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

// Deconstruct Icon - Knowledge analysis
const DeconstructIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
    </svg>
);

// Inference Icon - Multi-path reasoning
const InferenceIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="5" r="3" />
        <circle cx="6" cy="19" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="12" y1="8" x2="6" y2="16" />
        <line x1="12" y1="8" x2="18" y2="16" />
    </svg>
);

// Translate Icon
const TranslateIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m5 8 6 6" />
        <path d="m4 14 6-6 2-3" />
        <path d="M2 5h12" />
        <path d="M7 2h1" />
        <path d="m22 22-5-10-5 10" />
        <path d="M14 18h6" />
    </svg>
);

// Types
interface AIProviderInfo {
    id: string;
    name: string;
    model: string;
    available: boolean;
}

interface ChatRequest {
    message: string;
    context?: string;
    book_title?: string;
    chapter_content?: string;
    history?: { role: string; content: string }[];
    provider?: string;
    model?: string;
}

type StreamEvent =
    | { event: 'started'; data: { provider: string } }
    | { event: 'chunk'; data: { text: string } }
    | { event: 'done'; data: { fullText: string } }
    | { event: 'error'; data: { message: string } };

// Shared context from main window
interface SharedContext {
    bookTitle?: string;
    selectedText?: string;
    chapterContent?: string;
    theme?: string;
}

// Simple markdown parser
function parseMarkdownSimple(text: string): React.ReactNode[] {
    const lines = text.split('\n');
    return lines.map((line, i) => {
        // Bold
        line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Inline code
        line = line.replace(/`([^`]+)`/g, '<code>$1</code>');
        return <p key={i} dangerouslySetInnerHTML={{ __html: line || '&nbsp;' }} />;
    });
}

export function AIPanelWindow() {
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [_providers, setProviders] = useState<AIProviderInfo[]>([]);
    const [selectedProvider, setSelectedProvider] = useState<string>('claude');
    const [selectedModel, setSelectedModel] = useState<string>('sonnet');
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    const [sharedContext, setSharedContext] = useState<SharedContext>({});
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Apply theme from main window
    useEffect(() => {
        if (sharedContext.theme) {
            document.documentElement.setAttribute('data-theme', sharedContext.theme);
        }
    }, [sharedContext.theme]);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages, streamingContent]);

    // Listen for events from main window
    useEffect(() => {
        const unlisteners: (() => void)[] = [];

        const setup = async () => {
            // Listen for context updates from main window
            const unlisten1 = await listen<SharedContext>('ai-context-update', (event) => {
                console.log('Received context update:', event.payload);
                setSharedContext(event.payload);
            });
            unlisteners.push(unlisten1);

            // Listen for chat history sync
            const unlisten2 = await listen<ChatMessage[]>('ai-chat-sync', (event) => {
                setChatMessages(event.payload);
            });
            unlisteners.push(unlisten2);

            // Wait a bit for main window listener to be ready, then request initial context
            await new Promise(resolve => setTimeout(resolve, 100));
            await emit('ai-window-ready', {});

            // Check AI availability
            checkAIAvailability();
        };

        setup();

        return () => {
            unlisteners.forEach(fn => fn());
        };
    }, []);

    // Focus input
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const checkAIAvailability = async () => {
        try {
            const available = await invoke<AIProviderInfo[]>('check_ai_availability');
            setProviders(available);
            const firstAvailable = available.find(p => p.available);
            if (firstAvailable) {
                setSelectedProvider(firstAvailable.id);
            }
        } catch (e) {
            console.error('Failed to check AI availability:', e);
        }
    };

    const copyMessage = useCallback(async (messageId: string, content: string) => {
        try {
            await navigator.clipboard.writeText(content);
            setCopiedMessageId(messageId);
            setTimeout(() => setCopiedMessageId(null), 2000);
        } catch {
            console.error('Failed to copy message');
        }
    }, []);

    const sendMessage = async () => {
        if (!input.trim() || isLoading) return;

        // Reset cancel flag before starting
        await invoke('reset_ai_cancel');

        const userMessage: ChatMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: input.trim(),
            timestamp: Date.now(),
            context: sharedContext.selectedText || undefined,
        };

        const newMessages = [...chatMessages, userMessage];
        setChatMessages(newMessages);

        // Sync to main window
        await emit('ai-chat-update', newMessages);

        const messageToSend = input.trim();
        setInput('');
        setIsLoading(true);
        setStreamingContent('');

        try {
            const request: ChatRequest = {
                message: messageToSend,
                context: sharedContext.selectedText || undefined,
                book_title: sharedContext.bookTitle,
                chapter_content: sharedContext.chapterContent || undefined,
                history: chatMessages.slice(-10).map(m => ({
                    role: m.role,
                    content: m.content,
                })),
                model: selectedProvider === 'claude' ? selectedModel : undefined,
            };

            const onEvent = new Channel<StreamEvent>();
            let fullContent = '';
            let streamComplete = false;

            onEvent.onmessage = async (event: StreamEvent) => {
                switch (event.event) {
                    case 'chunk':
                        fullContent += event.data.text;
                        setStreamingContent(fullContent);
                        break;
                    case 'done':
                        streamComplete = true;
                        const assistantMessage: ChatMessage = {
                            id: (Date.now() + 1).toString(),
                            role: 'assistant',
                            content: event.data.fullText || fullContent,
                            timestamp: Date.now(),
                        };
                        const updatedMessages = [...newMessages, assistantMessage];
                        setChatMessages(updatedMessages);
                        await emit('ai-chat-update', updatedMessages);
                        setStreamingContent('');
                        setIsLoading(false);
                        break;
                    case 'error':
                        streamComplete = true;
                        const errorMessage: ChatMessage = {
                            id: (Date.now() + 1).toString(),
                            role: 'assistant',
                            content: event.data.message,
                            timestamp: Date.now(),
                        };
                        const errorMessages = [...newMessages, errorMessage];
                        setChatMessages(errorMessages);
                        await emit('ai-chat-update', errorMessages);
                        setStreamingContent('');
                        setIsLoading(false);
                        break;
                }
            };

            await invoke('chat_with_ai_streaming', { request, onEvent });

            if (!streamComplete && fullContent) {
                const assistantMessage: ChatMessage = {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: fullContent,
                    timestamp: Date.now(),
                };
                const finalMessages = [...newMessages, assistantMessage];
                setChatMessages(finalMessages);
                await emit('ai-chat-update', finalMessages);
                setStreamingContent('');
                setIsLoading(false);
            }
        } catch (error) {
            console.error('AI error:', error);
            const errorMessage: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: `Error: ${error}`,
                timestamp: Date.now(),
            };
            const errorMessages = [...newMessages, errorMessage];
            setChatMessages(errorMessages);
            await emit('ai-chat-update', errorMessages);
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
                    setChatMessages(prev => [...prev, stoppedMessage]);
                    emit('ai-chat-update', [...chatMessages, stoppedMessage]);
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

    const clearChat = async () => {
        setChatMessages([]);
        await emit('ai-chat-update', []);
    };

    const handleDock = async () => {
        // Emit event to main window to dock and close this window
        await emit('ai-dock-request', {});
        const currentWindow = getCurrentWebviewWindow();
        await currentWindow.close();
    };

    // Quick action buttons - 解释、拆解、推演、翻译
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

    return (
        <div className="ai-panel-window" data-theme={sharedContext.theme || 'light'}>
            <div className="ai-panel-header ai-panel-header-draggable" data-tauri-drag-region>
                <div className="ai-panel-title">
                    <AILogoIcon size={24} />
                    <span>AI Assistant</span>
                </div>
                <div className="ai-panel-actions">
                    {/* Claude Model Selector */}
                    {selectedProvider === 'claude' && (
                        <div className="ai-model-selector">
                            <button
                                className="ai-model-btn"
                                onClick={() => setShowModelDropdown(!showModelDropdown)}
                                title="Select Claude Model"
                            >
                                <span className="ai-model-name">{selectedModel}</span>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="6 9 12 15 18 9" />
                                </svg>
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
                    <button
                        className="btn btn-ghost btn-icon ai-dock-btn"
                        onClick={handleDock}
                        title="Dock to main window"
                    >
                        <DockIcon />
                    </button>
                </div>
            </div>

            {/* Context indicator */}
            {(sharedContext.bookTitle || sharedContext.selectedText) && (
                <div className="ai-context-bar">
                    {sharedContext.bookTitle && (
                        <div className="ai-context-item">
                            <span>{sharedContext.bookTitle}</span>
                        </div>
                    )}
                    {sharedContext.selectedText && (
                        <div className="ai-context-item ai-context-quote">
                            <span>"{sharedContext.selectedText.slice(0, 80)}{sharedContext.selectedText.length > 80 ? '...' : ''}"</span>
                        </div>
                    )}
                </div>
            )}

            <div className="ai-panel-messages">
                {chatMessages.length === 0 ? (
                    <div className="ai-panel-empty">
                        <SparkleIcon />
                        <p>Ask me anything about your book...</p>
                        <div className="ai-panel-suggestions">
                            {quickActions.map(action => (
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
                            <div className="ai-message-content">
                                {msg.role === 'assistant' ? (
                                    parseMarkdownSimple(msg.content)
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
                                    {parseMarkdownSimple(streamingContent)}
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

            <div className="ai-panel-input">
                <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about your book..."
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
        </div>
    );
}
