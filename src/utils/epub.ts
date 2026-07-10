import { strFromU8, unzipSync } from 'fflate';
import { readFile } from '@tauri-apps/plugin-fs';
import { createLogger } from './logger';

const logger = createLogger('EPUB');

export interface EpubMetadata {
  title: string;
  author: string;
  coverBlob?: Blob;
}

function fallbackMetadata(filePath: string): EpubMetadata {
  const fileName = filePath.split('/').pop() || 'Unknown';
  return {
    title: fileName.replace(/\.epub$/i, ''),
    author: 'Unknown',
  };
}

function readZipEntry(entries: Record<string, Uint8Array>, name: string): Uint8Array {
  const entry = entries[name];
  if (!entry) throw new Error(`EPUB entry not found: ${name}`);
  return entry;
}

function readZipText(entries: Record<string, Uint8Array>, name: string): string {
  return strFromU8(readZipEntry(entries, name));
}

function unzipSelected(data: Uint8Array, names: Iterable<string>): Record<string, Uint8Array> {
  const wanted = new Set(names);
  return unzipSync(data, {
    filter: (file) => wanted.has(file.name),
  });
}

function parseXml(raw: string, label: string): XMLDocument {
  const doc = new DOMParser().parseFromString(raw, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) throw new Error(`Failed to parse ${label}`);
  return doc;
}

function textForTag(doc: XMLDocument, tagName: string): string | undefined {
  const node = Array.from(doc.getElementsByTagName('*')).find(element => element.localName === tagName);
  return node?.textContent?.trim() || undefined;
}

function joinEpubPath(base: string, href: string): string {
  const parts = `${base}/${href}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function mediaTypeForPath(path: string, fallback?: string | null): string {
  if (fallback) return fallback;
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function findCoverItem(opf: XMLDocument): Element | null {
  const metaCoverId = Array.from(opf.getElementsByTagName('*'))
    .find(element => element.localName === 'meta' && element.getAttribute('name') === 'cover')
    ?.getAttribute('content');
  const items = Array.from(opf.getElementsByTagName('*')).filter(element => element.localName === 'item');
  if (metaCoverId) {
    const item = items.find(element => element.getAttribute('id') === metaCoverId);
    if (item) return item;
  }
  return items.find(element => {
    const properties = element.getAttribute('properties') ?? '';
    const mediaType = element.getAttribute('media-type') ?? '';
    const id = element.getAttribute('id') ?? '';
    return properties.split(/\s+/).includes('cover-image') ||
      id.toLowerCase().includes('cover') && mediaType.startsWith('image/');
  }) ?? null;
}

/**
 * Extract title/author/cover by decompressing only the needed ZIP entries
 * (container.xml → OPF → cover image), not the whole EPUB archive.
 */
export async function extractEpubMetadata(filePath: string): Promise<EpubMetadata> {
  logger.debug('Starting metadata extraction for:', filePath);

  try {
    const fileData = await readFile(filePath);

    const containerEntries = unzipSelected(fileData, ['META-INF/container.xml']);
    const container = parseXml(readZipText(containerEntries, 'META-INF/container.xml'), 'container.xml');
    const opfPath = Array.from(container.getElementsByTagName('*'))
      .find(element => element.localName === 'rootfile')
      ?.getAttribute('full-path');
    if (!opfPath) throw new Error('EPUB container did not declare an OPF package path');

    const opfEntries = unzipSelected(fileData, [opfPath]);
    const opf = parseXml(readZipText(opfEntries, opfPath), opfPath);
    const opfBase = opfPath.split('/').slice(0, -1).join('/');
    const title = textForTag(opf, 'title') ?? fallbackMetadata(filePath).title;
    const author = textForTag(opf, 'creator') ?? 'Unknown';

    let coverBlob: Blob | undefined;
    const coverItem = findCoverItem(opf);
    const coverHref = coverItem?.getAttribute('href');
    if (coverHref) {
      try {
        const coverPath = joinEpubPath(opfBase, coverHref);
        const coverEntries = unzipSelected(fileData, [coverPath]);
        const coverBytes = readZipEntry(coverEntries, coverPath);
        coverBlob = new Blob([coverBytes], {
          type: mediaTypeForPath(coverPath, coverItem?.getAttribute('media-type')),
        });
      } catch (coverError) {
        logger.warn('Could not extract EPUB cover:', coverError);
      }
    }

    return { title, author, coverBlob };
  } catch (error) {
    logger.error('Failed to extract EPUB metadata:', error);
    return fallbackMetadata(filePath);
  }
}
