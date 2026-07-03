import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { extractEpubMetadata } from './epub';

const fsMock = vi.hoisted(() => ({
  readFile: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: fsMock.readFile,
}));

function fixtureEpub(): Uint8Array {
  return zipSync({
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'),
    'OPS/book.opf': strToU8([
      '<package xmlns:dc="http://purl.org/dc/elements/1.1/">',
      '<metadata>',
      '<dc:title>Fixture Title</dc:title>',
      '<dc:creator>Fixture Author</dc:creator>',
      '<meta name="cover" content="cover-image"/>',
      '</metadata>',
      '<manifest><item id="cover-image" href="images/cover.png" media-type="image/png"/></manifest>',
      '</package>',
    ].join('')),
    'OPS/images/cover.png': new Uint8Array([137, 80, 78, 71]),
  });
}

describe('extractEpubMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts metadata and cover from the EPUB package', async () => {
    fsMock.readFile.mockResolvedValue(fixtureEpub());

    const metadata = await extractEpubMetadata('/tmp/book.epub');

    expect(metadata.title).toBe('Fixture Title');
    expect(metadata.author).toBe('Fixture Author');
    expect(metadata.coverBlob?.type).toBe('image/png');
    expect(metadata.coverBlob?.size).toBe(4);
  });

  it('falls back to the filename when the EPUB cannot be parsed', async () => {
    fsMock.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

    await expect(extractEpubMetadata('/tmp/Broken.epub')).resolves.toMatchObject({
      title: 'Broken',
      author: 'Unknown',
    });
  });
});
