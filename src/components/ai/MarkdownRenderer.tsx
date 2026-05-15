/**
 * Markdown Renderer Components for AI Panel
 * Handles parsing and rendering of markdown content with syntax highlighting
 */

import React, { useState } from 'react';
import { CopyIcon, CheckIcon } from './icons';
import { createLogger } from '../../utils/logger';

const logger = createLogger('MarkdownRenderer');

// ============================================
// Types
// ============================================

interface ParsedContent {
    type: 'text' | 'code-block' | 'inline-code' | 'bold' | 'italic' | 'link' | 'list' | 'blockquote' | 'heading' | 'hr';
    content: string;
    language?: string;
    level?: number;
    items?: string[];
    url?: string;
}

// ============================================
// Markdown Parser
// ============================================

export function parseMarkdown(text: string): ParsedContent[] {
    const result: ParsedContent[] = [];
    const lines = text.split('\n');
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Code blocks (```)
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

        // Headings
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

        // Horizontal rule
        if (/^[-*_]{3,}$/.test(line.trim())) {
            result.push({ type: 'hr', content: '' });
            i++;
            continue;
        }

        // Blockquote
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

        // Unordered list
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

        // Ordered list
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

        // Regular text
        result.push({ type: 'text', content: line });
        i++;
    }

    return result;
}

// ============================================
// Syntax Highlighter (Basic)
// ============================================

const LANGUAGE_KEYWORDS: Record<string, string[]> = {
    javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'import', 'export', 'from', 'async', 'await', 'try', 'catch', 'throw', 'new', 'this', 'super', 'extends', 'static', 'get', 'set', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void', 'null', 'undefined', 'true', 'false'],
    typescript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'import', 'export', 'from', 'async', 'await', 'try', 'catch', 'throw', 'new', 'this', 'super', 'extends', 'static', 'get', 'set', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void', 'null', 'undefined', 'true', 'false', 'type', 'interface', 'enum', 'namespace', 'module', 'declare', 'abstract', 'implements', 'private', 'protected', 'public', 'readonly', 'as', 'is', 'keyof', 'infer', 'never', 'unknown', 'any'],
    python: ['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'class', 'import', 'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'yield', 'global', 'nonlocal', 'pass', 'break', 'continue', 'and', 'or', 'not', 'in', 'is', 'None', 'True', 'False', 'async', 'await', 'self'],
    rust: ['fn', 'let', 'mut', 'const', 'if', 'else', 'for', 'while', 'loop', 'match', 'return', 'struct', 'enum', 'impl', 'trait', 'type', 'use', 'mod', 'pub', 'self', 'super', 'crate', 'async', 'await', 'move', 'ref', 'static', 'unsafe', 'where', 'dyn', 'true', 'false', 'Some', 'None', 'Ok', 'Err'],
    go: ['func', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'type', 'struct', 'interface', 'map', 'chan', 'go', 'select', 'defer', 'package', 'import', 'var', 'const', 'true', 'false', 'nil', 'make', 'new', 'append', 'len', 'cap'],
    java: ['public', 'private', 'protected', 'class', 'interface', 'extends', 'implements', 'static', 'final', 'void', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws', 'new', 'this', 'super', 'null', 'true', 'false', 'import', 'package', 'abstract', 'synchronized', 'volatile', 'transient', 'native', 'instanceof', 'enum'],
    css: ['@import', '@media', '@keyframes', '@font-face', '@supports', '!important'],
    html: ['<!DOCTYPE', '<html', '<head', '<body', '<div', '<span', '<p', '<a', '<img', '<script', '<style', '<link', '<meta', '<title'],
    json: [],
    sql: ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'DROP', 'ALTER', 'INDEX', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AS', 'ORDER', 'BY', 'ASC', 'DESC', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'NULL', 'IS', 'IN', 'BETWEEN', 'LIKE', 'EXISTS', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MAX', 'MIN'],
    bash: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'return', 'exit', 'export', 'source', 'echo', 'read', 'cd', 'pwd', 'ls', 'mkdir', 'rm', 'cp', 'mv', 'cat', 'grep', 'find', 'chmod', 'chown', 'sudo', 'apt', 'yum', 'brew', 'npm', 'yarn', 'git'],
    shell: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'return', 'exit', 'export', 'source', 'echo', 'read'],
};

function tokenizeLine(line: string, keywords: string[], startKey: number): React.ReactNode[] {
    const tokens: React.ReactNode[] = [];

    // Match strings
    const stringRegex = /(['"`])(?:(?!\1)[^\\]|\\.)*\1/g;
    // Match numbers
    const numberRegex = /\b\d+\.?\d*\b/g;

    let lastIndex = 0;
    const matches: { index: number; length: number; type: string; value: string }[] = [];

    // Find strings
    let match;
    while ((match = stringRegex.exec(line)) !== null) {
        matches.push({ index: match.index, length: match[0].length, type: 'string', value: match[0] });
    }

    // Find numbers (not inside strings)
    while ((match = numberRegex.exec(line)) !== null) {
        const isInString = matches.some(m => match!.index >= m.index && match!.index < m.index + m.length);
        if (!isInString) {
            matches.push({ index: match.index, length: match[0].length, type: 'number', value: match[0] });
        }
    }

    // Sort matches by index
    matches.sort((a, b) => a.index - b.index);

    // Find keywords
    const keywordMatches: { index: number; length: number; type: string; value: string }[] = [];
    keywords.forEach(keyword => {
        const regex = new RegExp(`\\b${keyword}\\b`, 'g');
        while ((match = regex.exec(line)) !== null) {
            const isInOther = matches.some(m => match!.index >= m.index && match!.index < m.index + m.length);
            if (!isInOther) {
                keywordMatches.push({ index: match.index, length: match[0].length, type: 'keyword', value: match[0] });
            }
        }
    });

    // Merge and sort all matches
    const allMatches = [...matches, ...keywordMatches].sort((a, b) => a.index - b.index);

    // Remove overlapping matches (keep first)
    const filteredMatches: typeof allMatches = [];
    for (const m of allMatches) {
        const overlaps = filteredMatches.some(fm =>
            (m.index >= fm.index && m.index < fm.index + fm.length) ||
            (fm.index >= m.index && fm.index < m.index + m.length)
        );
        if (!overlaps) {
            filteredMatches.push(m);
        }
    }

    // Build tokens
    filteredMatches.forEach((m, idx) => {
        if (m.index > lastIndex) {
            tokens.push(line.slice(lastIndex, m.index));
        }
        tokens.push(
            <span key={`${startKey}-${idx}`} className={m.type}>
                {m.value}
            </span>
        );
        lastIndex = m.index + m.length;
    });

    if (lastIndex < line.length) {
        tokens.push(line.slice(lastIndex));
    }

    return tokens;
}

export function highlightCode(code: string, language: string): React.ReactNode[] {
    const langKeywords = LANGUAGE_KEYWORDS[language.toLowerCase()] || LANGUAGE_KEYWORDS['javascript'] || [];

    // Simple tokenization
    const lines = code.split('\n');
    const result: React.ReactNode[] = [];

    lines.forEach((line, lineIndex) => {
        const tokens: React.ReactNode[] = [];
        const remaining = line;
        let keyIndex = 0;

        // Process comments
        const commentMatch = remaining.match(/(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/)/);
        if (commentMatch && commentMatch.index !== undefined) {
            const before = remaining.slice(0, commentMatch.index);
            const comment = commentMatch[0];
            const after = remaining.slice(commentMatch.index + comment.length);

            if (before) {
                tokens.push(...tokenizeLine(before, langKeywords, keyIndex));
                keyIndex += before.length;
            }
            tokens.push(<span key={`c-${lineIndex}`} className="comment">{comment}</span>);
            if (after) {
                tokens.push(...tokenizeLine(after, langKeywords, keyIndex + comment.length));
            }
        } else {
            tokens.push(...tokenizeLine(remaining, langKeywords, keyIndex));
        }

        result.push(
            <span key={lineIndex}>
                {tokens}
                {lineIndex < lines.length - 1 ? '\n' : ''}
            </span>
        );
    });

    return result;
}

// ============================================
// Code Block Component
// ============================================

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
                    title={copied ? 'Copied!' : 'Copy code'}
                >
                    {copied ? <CheckIcon /> : <CopyIcon />}
                    <span>{copied ? 'Copied!' : 'Copy'}</span>
                </button>
            </div>
            <pre>
                <code>{highlightCode(code, language)}</code>
            </pre>
        </div>
    );
}

// ============================================
// Inline Formatting
// ============================================

export function renderInlineFormatting(text: string): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    const remaining = text;
    let key = 0;

    // Find all matches
    const allMatches: { index: number; length: number; replacement: React.ReactNode }[] = [];

    // Bold
    let match;
    const boldRegex = /\*\*(.+?)\*\*/g;
    while ((match = boldRegex.exec(remaining)) !== null) {
        allMatches.push({
            index: match.index,
            length: match[0].length,
            replacement: <strong key={`b-${key++}`}>{match[1]}</strong>,
        });
    }

    // Italic (asterisk)
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

    // Inline code
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

    // Links
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

    // Sort by index
    allMatches.sort((a, b) => a.index - b.index);

    // Build result
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

// ============================================
// Message Formatter Component
// ============================================

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
