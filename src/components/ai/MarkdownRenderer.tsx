import React, { useState } from 'react';
import { CopyIcon, CheckIcon } from './icons';
import { createLogger } from '../../utils/logger';

const logger = createLogger('MarkdownRenderer');

interface ParsedContent {
    type: 'text' | 'code-block' | 'list' | 'blockquote' | 'heading' | 'hr';
    content: string;
    language?: string;
    level?: number;
    items?: string[];
}

export function parseMarkdown(text: string): ParsedContent[] {
    const result: ParsedContent[] = [];
    const lines = text.split('\n');
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (line.startsWith('```')) {
            const language = line.slice(3).trim() || 'text';
            const codeLines: string[] = [];
            i++;
            while (i < lines.length && !lines[i].startsWith('```')) {
                codeLines.push(lines[i]);
                i++;
            }
            result.push({
                type: 'code-block',
                content: codeLines.join('\n'),
                language,
            });
            i++;
            continue;
        }

        const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
            result.push({
                type: 'heading',
                content: headingMatch[2],
                level: headingMatch[1].length,
            });
            i++;
            continue;
        }

        if (/^[-*_]{3,}$/.test(line.trim())) {
            result.push({ type: 'hr', content: '' });
            i++;
            continue;
        }

        if (line.startsWith('>')) {
            const quoteLines: string[] = [];
            while (i < lines.length && (lines[i].startsWith('>') || (lines[i].trim() === '' && i + 1 < lines.length && lines[i + 1].startsWith('>')))) {
                quoteLines.push(lines[i].replace(/^>\s?/, ''));
                i++;
            }
            result.push({
                type: 'blockquote',
                content: quoteLines.join('\n'),
            });
            continue;
        }

        if (/^[-*+]\s/.test(line)) {
            const items: string[] = [];
            while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
                items.push(lines[i].replace(/^[-*+]\s/, ''));
                i++;
            }
            result.push({
                type: 'list',
                content: '',
                items,
            });
            continue;
        }

        if (/^\d+\.\s/.test(line)) {
            const items: string[] = [];
            while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
                items.push(lines[i].replace(/^\d+\.\s/, ''));
                i++;
            }
            result.push({
                type: 'list',
                content: 'ordered',
                items,
            });
            continue;
        }

        result.push({ type: 'text', content: line });
        i++;
    }

    return result;
}

export function CodeBlock({ code, language }: { code: string; language: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            logger.warn('Failed to copy code');
        }
    };

    return (
        <div className="ai-code-block">
            <div className="ai-code-header">
                <span className="ai-code-lang">{language}</span>
                <button
                    className={`ai-code-copy ${copied ? 'copied' : ''}`}
                    onClick={handleCopy}
                >
                    {copied ? <CheckIcon /> : <CopyIcon />}
                    <span>{copied ? '已复制' : '复制'}</span>
                </button>
            </div>
            <pre>
                <code>{code}</code>
            </pre>
        </div>
    );
}

export function renderInlineFormatting(text: string): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    const remaining = text;
    let key = 0;

    const allMatches: { index: number; length: number; replacement: React.ReactNode }[] = [];

    let match;
    const boldRegex = /\*\*(.+?)\*\*/g;
    while ((match = boldRegex.exec(remaining)) !== null) {
        allMatches.push({
            index: match.index,
            length: match[0].length,
            replacement: <strong key={`b-${key++}`}>{match[1]}</strong>,
        });
    }

    const italicRegex = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g;
    while ((match = italicRegex.exec(remaining)) !== null) {
        const overlaps = allMatches.some(m =>
            (match!.index >= m.index && match!.index < m.index + m.length) ||
            (m.index >= match!.index && m.index < match!.index + match![0].length)
        );
        if (!overlaps) {
            allMatches.push({
                index: match.index,
                length: match[0].length,
                replacement: <em key={`i-${key++}`}>{match[1]}</em>,
            });
        }
    }

    const codeRegex = /`([^`]+)`/g;
    while ((match = codeRegex.exec(remaining)) !== null) {
        const overlaps = allMatches.some(m =>
            (match!.index >= m.index && match!.index < m.index + m.length)
        );
        if (!overlaps) {
            allMatches.push({
                index: match.index,
                length: match[0].length,
                replacement: <code key={`c-${key++}`}>{match[1]}</code>,
            });
        }
    }

    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((match = linkRegex.exec(remaining)) !== null) {
        const overlaps = allMatches.some(m =>
            (match!.index >= m.index && match!.index < m.index + m.length)
        );
        if (!overlaps) {
            allMatches.push({
                index: match.index,
                length: match[0].length,
                replacement: <a key={`l-${key++}`} href={match[2]} target="_blank" rel="noopener noreferrer">{match[1]}</a>,
            });
        }
    }

    allMatches.sort((a, b) => a.index - b.index);

    let lastIndex = 0;
    allMatches.forEach(m => {
        if (m.index > lastIndex) {
            nodes.push(remaining.slice(lastIndex, m.index));
        }
        nodes.push(m.replacement);
        lastIndex = m.index + m.length;
    });

    if (lastIndex < remaining.length) {
        nodes.push(remaining.slice(lastIndex));
    }

    return nodes.length > 0 ? nodes : [text];
}

export function FormatMessage({ content }: { content: string }) {
    const parsed = parseMarkdown(content);

    return (
        <>
            {parsed.map((block, index) => {
                switch (block.type) {
                    case 'code-block':
                        return <CodeBlock key={index} code={block.content} language={block.language || 'text'} />;

                    case 'heading': {
                        const level = block.level || 2;
                        if (level === 1) return <h1 key={index}>{renderInlineFormatting(block.content)}</h1>;
                        if (level === 2) return <h2 key={index}>{renderInlineFormatting(block.content)}</h2>;
                        if (level === 3) return <h3 key={index}>{renderInlineFormatting(block.content)}</h3>;
                        return <h4 key={index}>{renderInlineFormatting(block.content)}</h4>;
                    }

                    case 'hr':
                        return <hr key={index} />;

                    case 'blockquote':
                        return <blockquote key={index}>{renderInlineFormatting(block.content)}</blockquote>;

                    case 'list':
                        if (block.content === 'ordered') {
                            return (
                                <ol key={index}>
                                    {block.items?.map((item, i) => (
                                        <li key={i}>{renderInlineFormatting(item)}</li>
                                    ))}
                                </ol>
                            );
                        }
                        return (
                            <ul key={index}>
                                {block.items?.map((item, i) => (
                                    <li key={i}>{renderInlineFormatting(item)}</li>
                                ))}
                            </ul>
                        );

                    case 'text':
                    default:
                        if (!block.content.trim()) {
                            return <p key={index}><br /></p>;
                        }
                        return <p key={index}>{renderInlineFormatting(block.content)}</p>;
                }
            })}
        </>
    );
}
