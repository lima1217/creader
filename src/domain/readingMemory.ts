import type { Book, ChatMessage, ReadingProgress } from '../types';
import type { ReadingContextSnapshot } from './readingSource';

export type ReadingMemoryIngestInput = {
  rootPath: string;
  book: Book;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  selectedContext?: string;
  selectedCfiRange?: string;
  currentChapter?: string;
  progress?: ReadingProgress;
};

export function buildReadingMemoryIngestInput(params: {
  rootPath: string;
  readingContext: ReadingContextSnapshot;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}): ReadingMemoryIngestInput | null {
  const book = params.readingContext.book;
  if (!book) return null;

  return {
    rootPath: params.rootPath,
    book,
    userMessage: params.userMessage,
    assistantMessage: params.assistantMessage,
    selectedContext: params.userMessage.context || params.readingContext.selection?.text,
    selectedCfiRange: params.userMessage.contextCfi || params.readingContext.selection?.cfiRange,
    currentChapter: params.readingContext.chapterContent,
    progress: params.readingContext.progress || book.progress,
  };
}
