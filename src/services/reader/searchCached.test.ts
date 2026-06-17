import { describe, expect, it, vi } from 'vitest';
import { searchBookCached } from './searchCached';
import type { EpubBookLike } from './epubAdapter';

vi.mock('../idb', () => ({
  idbGet: vi.fn(async () => null),
  idbPut: vi.fn(async () => undefined),
}));

describe('searchBookCached', () => {
  it('falls back to loaded section text when item.find returns no matches', async () => {
    const book = {
      spine: {
        spineItems: [{
          href: 'chapter.xhtml',
          idref: 'Chapter 1',
          find: async () => [],
          load: async () => '<p>The hidden needle is here.</p>',
        }],
      },
    } as unknown as EpubBookLike;

    await expect(searchBookCached(book, 'book-1', '/tmp/book.epub', 'needle', () => false))
      .resolves.toMatchObject([
        { cfi: 'chapter.xhtml', section: 'Chapter 1' },
      ]);
  });
});
