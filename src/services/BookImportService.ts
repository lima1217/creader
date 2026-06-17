import { extractEpubMetadata } from '../utils/epub';
import { saveCover } from './CoverStore';
import type { Book } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('BookImportService');

export type ImportBookResult =
  | { status: 'skipped'; reason: 'duplicate' }
  | { status: 'imported'; book: Book };

export async function tryCopyBookToLibrary(params: {
  sourcePath: string;
  bookId: string;
}): Promise<{ finalPath: string; copied: boolean }> {
  const { sourcePath, bookId } = params;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{ new_path: string; book_id: string }>('import_book_to_library', {
      sourcePath,
      bookId,
    });
    return { finalPath: result.new_path, copied: true };
  } catch (error) {
    logger.warn('Failed to copy book to library, using original path:', error);
    return { finalPath: sourcePath, copied: false };
  }
}

export async function importBookFromPath(params: {
  filePath: string;
  existingFilePaths?: ReadonlySet<string>;
  bookId?: string;
}): Promise<ImportBookResult> {
  const { filePath, existingFilePaths } = params;
  const bookId = params.bookId ?? Date.now().toString();

  if (existingFilePaths?.has(filePath)) {
    return { status: 'skipped', reason: 'duplicate' };
  }

  if (!filePath.toLowerCase().endsWith('.epub')) {
    throw new Error('Only EPUB files are supported.');
  }
  const { finalPath } = await tryCopyBookToLibrary({ sourcePath: filePath, bookId });

  let title = 'Unknown';
  let author = 'Unknown';
  let coverKey: string | undefined;

  const metadata = await extractEpubMetadata(finalPath);
  title = metadata.title;
  author = metadata.author;

  if (metadata.coverBlob) {
    try {
      await saveCover(bookId, metadata.coverBlob);
      coverKey = bookId;
    } catch (error) {
      logger.error('Failed to persist cover:', error);
    }
  }

  const book: Book = {
    id: bookId,
    title,
    author,
    format: 'epub',
    coverKey,
    filePath: finalPath,
    addedAt: Date.now(),
    progress: {
      currentCfi: '',
      percentage: 0,
    },
  };

  return { status: 'imported', book };
}
