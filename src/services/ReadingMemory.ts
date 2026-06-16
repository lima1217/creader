import { invoke } from '@tauri-apps/api/core';
import type { ReadingMemoryIngestInput } from '../domain/readingMemory';

export {
  buildReadingMemoryMarkdown,
  buildReadingMemoryIngestInput,
  classifyReadingMemoryCandidate,
  type ReadingMemoryCandidate,
  type ReadingMemoryIngestInput,
  type ReadingMemoryMarkdown,
} from '../domain/readingMemory';

type DirectIngestResult = {
  note_path: string;
  log_path: string;
  skipped: boolean;
  reason: string;
};

export async function ensureReadingMemoryRepository(rootPath: string): Promise<string> {
  return await invoke<string>('ensure_reading_memory_repository', { rootPath });
}

export async function ingestReadingMemoryDirect(
  input: ReadingMemoryIngestInput & { provider?: string; model?: string }
): Promise<DirectIngestResult | null> {
  if (!input.rootPath || !input.book || !input.assistantMessage.content.trim()) return null;
  return await invoke<DirectIngestResult>('ingest_reading_memory_direct', {
    request: {
      root_path: input.rootPath,
      book_title: input.book.title,
      book_author: input.book.author,
      source_chapter: (input.progress || input.book.progress).currentChapter || '',
      source_cfi: input.selectedCfiRange || input.userMessage.contextCfi || (input.progress || input.book.progress).currentCfi || '',
      source_progress: (input.progress || input.book.progress).percentage || 0,
      user_question: input.userMessage.content,
      selected_excerpt: input.selectedContext || input.userMessage.context || input.currentChapter || '',
      assistant_answer: input.assistantMessage.content,
      provider: input.provider,
      model: input.model,
    },
  });
}
