import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importBookFromFile } from './BookImportService';
import { uint8ArrayToBase64 } from '../utils/base64Bytes';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('../utils/epub', () => ({
  extractEpubMetadata: vi.fn().mockResolvedValue({
    title: 'Imported',
    author: 'Author',
    coverBlob: undefined,
  }),
}));

function makeEpubFile(body = 'epub', name = 'book.epub'): File {
  const file = new File([body], name, { type: 'application/epub+zip' });
  file.arrayBuffer = async () => new TextEncoder().encode(body).buffer;
  return file;
}

describe('BookImportService file import', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('previews the library path before writing bytes', async () => {
    invokeMock
      .mockResolvedValueOnce({ path: '/library/99_book.epub' })
      .mockResolvedValueOnce({ new_path: '/library/99_book.epub', book_id: '99' });

    const file = makeEpubFile('epub', 'book.epub');
    const result = await importBookFromFile({ file, bookId: '99' });

    expect(result).toMatchObject({
      status: 'imported',
      book: {
        id: '99',
        title: 'Imported',
        author: 'Author',
        filePath: '/library/99_book.epub',
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'preview_import_book_path', {
      bookId: '99',
      fileName: 'book.epub',
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'import_book_bytes_to_library', {
      bookId: '99',
      fileName: 'book.epub',
      bytesBase64: uint8ArrayToBase64(new Uint8Array([101, 112, 117, 98])),
    });
  });

  it('skips import before writing when the previewed path already exists', async () => {
    invokeMock.mockResolvedValueOnce({ path: '/library/existing.epub' });

    const file = makeEpubFile('epub', 'book.epub');
    const result = await importBookFromFile({
      file,
      bookId: '1',
      existingFilePaths: new Set(['/library/existing.epub']),
    });

    expect(result).toEqual({ status: 'skipped', reason: 'duplicate' });
    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith('preview_import_book_path', {
      bookId: '1',
      fileName: 'book.epub',
    });
  });

  it('rejects non-epub files before invoking the backend', async () => {
    const file = new File(['txt'], 'notes.txt', { type: 'text/plain' });

    await expect(importBookFromFile({ file })).rejects.toThrow('Only EPUB files are supported.');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
