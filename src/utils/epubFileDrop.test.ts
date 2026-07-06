import { describe, expect, it } from 'vitest';
import { firstEpubFile, isExternalFileDrag } from './epubFileDrop';

describe('epubFileDrop', () => {
  it('detects external file drags by Files type', () => {
    const event = {
      dataTransfer: { types: ['Files'] },
    } as unknown as DragEvent;
    expect(isExternalFileDrag(event)).toBe(true);
  });

  it('ignores internal library organizer drags', () => {
    const event = {
      dataTransfer: { types: ['application/x-creader-book-id', 'text/plain'] },
    } as unknown as DragEvent;
    expect(isExternalFileDrag(event)).toBe(false);
  });

  it('returns the first epub from a file list', () => {
    const files = {
      0: new File(['x'], 'notes.txt', { type: 'text/plain' }),
      1: new File(['y'], 'book.epub', { type: 'application/epub+zip' }),
      length: 2,
      item: (index: number) => (index === 0 ? files[0] : files[1]),
      [Symbol.iterator]: function* () {
        yield files[0];
        yield files[1];
      },
    } as FileList;

    expect(firstEpubFile(files)?.name).toBe('book.epub');
  });
});
