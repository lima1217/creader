import type { BookFormat } from '../types';

export function getBookFormat(filePath: string): BookFormat {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext !== 'epub') {
    throw new Error('Only EPUB files are supported.');
  }
  return 'epub';
}
