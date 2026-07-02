import { invoke } from '@tauri-apps/api/core';
import type { ReadingMemoryIngestInput } from '../domain/readingMemory';
import {
  renderReadingMemoryNoteMarkdown,
  rewriteReadingMemoryPageMarkdown,
  type ReadingMemoryNoteDecision,
  type ReadingMemoryNoteRenderInput,
  type ReadingMemorySectionRewrite,
} from '../domain/readingMemoryMarkdown';

export {
  buildReadingMemoryIngestInput,
  type ReadingMemoryIngestInput,
} from '../domain/readingMemory';
export { rewriteReadingMemoryPageMarkdown } from '../domain/readingMemoryMarkdown';

type DirectIngestResult = {
  note_path: string;
  log_path: string;
  skipped: boolean;
  reason: string;
};

type DirectReviewResult = {
  skipped: boolean;
  reason: string;
  decision?: ReadingMemoryNoteDecision;
};

type RewritePageResult = {
  page_path: string;
  skipped: boolean;
  reason: string;
};

export async function ensureReadingMemoryRepository(rootPath: string): Promise<string> {
  return await invoke<string>('ensure_reading_memory_repository', { rootPath });
}

export async function ingestReadingMemoryDirect(
  input: ReadingMemoryIngestInput
): Promise<DirectIngestResult | null> {
  if (!input.rootPath || !input.book || !input.assistantMessage.content.trim()) return null;

  const request = buildDirectIngestRequest(input);
  const review = await invoke<DirectReviewResult>('review_reading_memory_direct', { request });
  if (review.skipped || !review.decision) {
    return {
      note_path: '',
      log_path: '',
      skipped: true,
      reason: review.reason,
    };
  }

  const renderedMarkdown = renderReadingMemoryNoteMarkdown(request, review.decision);
  return await invoke<DirectIngestResult>('write_reading_memory_note', {
    request,
    decision: review.decision,
    renderedMarkdown,
  });
}

export async function rewriteReadingMemoryPage(input: {
  rootPath: string;
  relativePath: string;
  markdown: string;
  rewrite: ReadingMemorySectionRewrite;
}): Promise<RewritePageResult> {
  const markdown = rewriteReadingMemoryPageMarkdown(input.markdown, input.rewrite);
  return await invoke<RewritePageResult>('rewrite_reading_memory_page', {
    rootPath: input.rootPath,
    relativePath: input.relativePath,
    markdown,
  });
}

function buildDirectIngestRequest(input: ReadingMemoryIngestInput): ReadingMemoryNoteRenderInput & {
  root_path: string;
} {
  const progress = input.progress || input.book.progress;
  return {
    root_path: input.rootPath,
    book_title: input.book.title,
    book_author: input.book.author,
    source_chapter: progress.currentChapter || '',
    source_cfi: input.selectedCfiRange || input.userMessage.contextCfi || progress.currentCfi || '',
    source_progress: progress.percentage || 0,
    user_question: input.userMessage.content,
    selected_excerpt: input.selectedContext || input.userMessage.context || input.currentChapter || '',
    assistant_answer: input.assistantMessage.content,
  };
}
