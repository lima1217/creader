const SELECTED_CONTEXT_RADIUS = 900;
const FALLBACK_CHAPTER_EXCERPT = 1200;
const LONG_FOCUS_THRESHOLD = 2400;

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function withEllipsis(text: string, truncatedStart: boolean, truncatedEnd: boolean): string {
  const body = text.trim();
  if (!body) return '';
  return `${truncatedStart ? '...' : ''}${body}${truncatedEnd ? '...' : ''}`;
}

export function buildSmartChapterContext(params: {
  chapterContent?: string;
  focusTexts: string[];
}): string | undefined {
  const chapter = normalizeText(params.chapterContent || '');
  if (!chapter) return undefined;

  const focusTexts = params.focusTexts
    .map(text => normalizeText(text))
    .filter(Boolean);

  if (focusTexts.length === 0) return chapter;

  const totalFocusLength = focusTexts.reduce((sum, text) => sum + text.length, 0);
  if (totalFocusLength >= LONG_FOCUS_THRESHOLD) return undefined;

  const focus = focusTexts
    .slice()
    .sort((a, b) => b.length - a.length)
    .find(text => text.length >= 12 && chapter.includes(text));

  if (!focus) {
    const excerpt = chapter.slice(0, FALLBACK_CHAPTER_EXCERPT);
    return [
      'Chapter excerpt for background. The selected text was not found in the extracted chapter text:',
      withEllipsis(excerpt, false, chapter.length > FALLBACK_CHAPTER_EXCERPT),
    ].join('\n');
  }

  const index = chapter.indexOf(focus);
  const beforeStart = Math.max(0, index - SELECTED_CONTEXT_RADIUS);
  const afterEnd = Math.min(chapter.length, index + focus.length + SELECTED_CONTEXT_RADIUS);
  const before = withEllipsis(chapter.slice(beforeStart, index), beforeStart > 0, false);
  const after = withEllipsis(chapter.slice(index + focus.length, afterEnd), false, afterEnd < chapter.length);

  const parts = ['Surrounding chapter context near the selected text. Do not treat this as the selected text itself.'];
  if (before) parts.push(`Before:\n${before}`);
  if (after) parts.push(`After:\n${after}`);
  return parts.join('\n\n');
}
