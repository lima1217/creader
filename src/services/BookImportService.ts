import { extractEpubMetadata } from '../utils/epub';
import { uint8ArrayToBase64 } from '../utils/base64Bytes';
import { saveCover } from './CoverStore';
import type { Book } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('BookImportService');

export type ImportBookResult =
  | { status: 'skipped'; reason: 'duplicate' }
  | { status: 'imported'; book: Book };

async function buildImportedBook(params: {
  bookId: string;
  finalPath: string;
}): Promise<Book> {
  const { bookId, finalPath } = params;

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

  return {
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
}

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

  const book = await buildImportedBook({ bookId, finalPath });

  return { status: 'imported', book };
}

export async function importBookFromFile(params: {
  file: File;
  existingFilePaths?: ReadonlySet<string>;
  bookId?: string;
}): Promise<ImportBookResult> {
  const { file, existingFilePaths } = params;
  const bookId = params.bookId ?? Date.now().toString();

  if (!file.name.toLowerCase().endsWith('.epub')) {
    throw new Error('Only EPUB files are supported.');
  }

  const { invoke } = await import('@tauri-apps/api/core');
  const { path: finalPath } = await invoke<{ path: string }>('preview_import_book_path', {
    bookId,
    fileName: file.name,
  });

  if (existingFilePaths?.has(finalPath)) {
    return { status: 'skipped', reason: 'duplicate' };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { new_path: importedPath } = await invoke<{ new_path: string; book_id: string }>(
    'import_book_bytes_to_library',
    {
      bookId,
      fileName: file.name,
      bytesBase64: uint8ArrayToBase64(bytes),
    },
  );

  const book = await buildImportedBook({ bookId, finalPath: importedPath });

  return { status: 'imported', book };
}
