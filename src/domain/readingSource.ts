import type { Book, ReadingProgress } from '../types';

export type ReadingSourceKind = 'epub';

export interface ReadingSelection {
  text: string;
  cfiRange?: string;
}

export interface ReadingContextSnapshot {
  kind: ReadingSourceKind;
  book: Book | null;
  progress?: ReadingProgress;
  selection?: ReadingSelection;
  accumulatedTexts: string[];
  chapterContent?: string;
}

export function buildReadingContextSnapshot(params: {
  book?: Book | null;
  progress?: ReadingProgress;
  selectedText?: string;
  selectedCfiRange?: string;
  accumulatedTexts?: string[];
  chapterContent?: string;
}): ReadingContextSnapshot {
  const selectedText = (params.selectedText || '').trim();
  const selectedCfiRange = (params.selectedCfiRange || '').trim();
  const progress = params.progress || params.book?.progress;
  const frozenProgress = progress ? { ...progress } : undefined;
  const frozenBook = params.book
    ? {
        ...params.book,
        progress: frozenProgress || { ...params.book.progress },
      }
    : null;

  return {
    kind: 'epub',
    book: frozenBook,
    progress: frozenProgress || frozenBook?.progress,
    selection: selectedText
      ? {
          text: selectedText,
          cfiRange: selectedCfiRange || undefined,
        }
      : undefined,
    accumulatedTexts: (params.accumulatedTexts || [])
      .map(text => text.trim())
      .filter(Boolean),
    chapterContent: params.chapterContent,
  };
}

export function getReadingFocusTexts(snapshot: ReadingContextSnapshot): string[] {
  const focusTexts: string[] = [];
  if (snapshot.selection?.text) focusTexts.push(snapshot.selection.text);
  if (snapshot.accumulatedTexts.length > 0) focusTexts.push(...snapshot.accumulatedTexts);
  return focusTexts;
}
