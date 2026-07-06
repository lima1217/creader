export const MAX_CHAPTER_PROMPT_CHARS = 8000;

const LONG_FOCUS_THRESHOLD = 2400;
const MIN_FOCUS_MATCH_CHARS = 12;

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toScalars(text: string): string[] {
  return [...text];
}

export function scalarIndexOf(haystack: string, needle: string): number {
  if (!needle) return -1;
  const hay = toScalars(haystack);
  const ned = toScalars(needle);
  if (ned.length === 0 || ned.length > hay.length) return -1;
  outer: for (let i = 0; i <= hay.length - ned.length; i += 1) {
    for (let j = 0; j < ned.length; j += 1) {
      if (hay[i + j] !== ned[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function sliceChapterContent(
  text: string,
  maxLen: number,
  focusText?: string,
): { text: string; offset: number; truncatedEnd: boolean } {
  const scalars = toScalars(text);
  const total = scalars.length;
  if (total <= maxLen) {
    return { text, offset: 0, truncatedEnd: false };
  }

  const focus = (focusText || '').trim();
  if (focus) {
    const focusStart = scalarIndexOf(text, focus);
    if (focusStart >= 0) {
      const focusMid = focusStart + Math.floor(toScalars(focus).length / 2);
      let start = Math.max(0, focusMid - Math.floor(maxLen / 2));
      let end = Math.min(total, start + maxLen);
      if (end - start < maxLen) start = Math.max(0, end - maxLen);
      return {
        text: scalars.slice(start, end).join(''),
        offset: start,
        truncatedEnd: end < total,
      };
    }
  }

  return {
    text: scalars.slice(0, maxLen).join(''),
    offset: 0,
    truncatedEnd: true,
  };
}

function withEllipsis(text: string, truncatedStart: boolean, truncatedEnd: boolean): string {
  const body = text.trim();
  if (!body) return '';
  return `${truncatedStart ? '…' : ''}${body}${truncatedEnd ? '…' : ''}`;
}

function buildTruncationHint(params: {
  chapterIndex?: number;
  offset: number;
  truncatedStart: boolean;
  truncatedEnd: boolean;
}): string {
  if (!params.truncatedStart && !params.truncatedEnd) return '';
  const indexPart = params.chapterIndex !== undefined
    ? `index=${params.chapterIndex}, `
    : '';
  return `（本段已截断，前/后仍有内容。可用 get_chapter_text(${indexPart}offset=${params.offset}) 继续阅读。）`;
}

function centerWindow(params: {
  chapter: string;
  focusStart?: number;
  focusEnd?: number;
  budget: number;
}): { text: string; offset: number; truncatedStart: boolean; truncatedEnd: boolean } {
  const scalars = toScalars(params.chapter);
  const total = scalars.length;
  if (total <= params.budget) {
    return { text: params.chapter, offset: 0, truncatedStart: false, truncatedEnd: false };
  }

  const focusStart = params.focusStart ?? Math.floor(total / 2);
  const focusEnd = params.focusEnd ?? focusStart;
  const focusMid = Math.floor((focusStart + focusEnd) / 2);

  let start = Math.max(0, focusMid - Math.floor(params.budget / 2));
  let end = Math.min(total, start + params.budget);
  if (end - start < params.budget) {
    start = Math.max(0, end - params.budget);
  }

  const text = scalars.slice(start, end).join('');
  return {
    text,
    offset: start,
    truncatedStart: start > 0,
    truncatedEnd: end < total,
  };
}

export function buildSmartChapterContext(params: {
  chapterContent?: string;
  focusTexts: string[];
  chapterIndex?: number;
  chapterContentOffset?: number;
  chapterSliceTruncatedEnd?: boolean;
}): string | undefined {
  const chapter = normalizeText(params.chapterContent || '');
  if (!chapter) return undefined;

  const focusTexts = params.focusTexts
    .map(text => normalizeText(text))
    .filter(Boolean);

  if (focusTexts.length > 0) {
    const totalFocusLength = focusTexts.reduce((sum, text) => sum + text.length, 0);
    if (totalFocusLength >= LONG_FOCUS_THRESHOLD) return undefined;
  }

  const focus = focusTexts
    .slice()
    .sort((a, b) => b.length - a.length)
    .find(text => text.length >= MIN_FOCUS_MATCH_CHARS && chapter.includes(text));

  const focusStart = focus ? scalarIndexOf(chapter, focus) : -1;
  const focusEnd = focusStart >= 0 ? focusStart + toScalars(focus!).length : undefined;

  const window = centerWindow({
    chapter,
    focusStart: focusStart >= 0 ? focusStart : undefined,
    focusEnd,
    budget: MAX_CHAPTER_PROMPT_CHARS,
  });

  const baseOffset = params.chapterContentOffset ?? 0;

  const hint = buildTruncationHint({
    chapterIndex: params.chapterIndex,
    offset: baseOffset + window.offset,
    truncatedStart: window.truncatedStart || baseOffset > 0,
    truncatedEnd: window.truncatedEnd || Boolean(params.chapterSliceTruncatedEnd),
  });

  const body = withEllipsis(window.text, window.truncatedStart, window.truncatedEnd);
  const intro = focus
    ? 'Surrounding chapter context near the selected text. Do not treat this as the selected text itself.'
    : 'Chapter excerpt for background.';

  return hint ? `${intro}\n${body}\n${hint}` : `${intro}\n${body}`;
}
