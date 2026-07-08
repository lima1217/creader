import { extractEpubMetadata } from '../utils/epub';
import { uint8ArrayToBase64 } from '../utils/base64Bytes';
import { saveCover } from './CoverStore';
import type { Book } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('BookImportService');

export type ImportBookResult =
  | { status: 'skipped'; reason: 'duplicate' }
  | { status: 'imported'; book: Book };

/**
 * Collision-resistant id for imported books. Uses the WebView's native
 * crypto.randomUUID when available; falls back to a timestamp + random suffix
 * for older runtimes. Replaces Date.now().toString(), which collided when two
 * books imported in the same millisecond produced identical ids.
 */
export function generateBookId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Best-effort file name extraction from a path (Tauri passes OS-style paths). */
async function resolveFileName(filePath: string): Promise<string> {
  const normalized = filePath.replace(/\\/g, '/');
  const leaf = normalized.split('/').pop();
  return leaf && leaf.length > 0 ? leaf : 'book.epub';
}

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
}): Promise<{ finalPath: string }> {
  const { sourcePath, bookId } = params;
  const { invoke } = await import('@tauri-apps/api/core');
  const result = await invoke<{ new_path: string; book_id: string }>('import_book_to_library', {
    sourcePath,
    bookId,
  });
  return { finalPath: result.new_path };
}

export async function importBookFromPath(params: {
  filePath: string;
  existingFilePaths?: ReadonlySet<string>;
  bookId?: string;
}): Promise<ImportBookResult> {
  const { filePath, existingFilePaths } = params;
  const bookId = params.bookId ?? generateBookId();

  if (!filePath.toLowerCase().endsWith('.epub')) {
    throw new Error('Only EPUB files are supported.');
  }

  // Dedup by the final library destination path (same scheme as
  // importBookFromFile) so re-importing the same book from a different source
  // location is still detected as a duplicate.
  const { invoke } = await import('@tauri-apps/api/core');
  const fileName = await resolveFileName(filePath);
  const { path: finalPath } = await invoke<{ path: string }>('preview_import_book_path', {
    bookId,
    fileName,
  });
  if (existingFilePaths?.has(finalPath)) {
    return { status: 'skipped', reason: 'duplicate' };
  }

  const { finalPath: copiedPath } = await tryCopyBookToLibrary({ sourcePath: filePath, bookId });

  const book = await buildImportedBook({ bookId, finalPath: copiedPath });

  return { status: 'imported', book };
}

export async function importBookFromFile(params: {
  file: File;
  existingFilePaths?: ReadonlySet<string>;
  bookId?: string;
}): Promise<ImportBookResult> {
  const { file, existingFilePaths } = params;
  const bookId = params.bookId ?? generateBookId();

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
