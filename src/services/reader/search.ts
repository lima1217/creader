import type { ReaderSearchResult } from './types';
import type { EpubBookLike } from './epubAdapter';
import { createLogger } from '../../utils/logger';

const logger = createLogger('search');

export async function searchBook(
  book: EpubBookLike,
  searchQuery: string,
  isCancelled: () => boolean
): Promise<ReaderSearchResult[]> {
  const results: ReaderSearchResult[] = [];
  const query = searchQuery.toLowerCase();

  if (!book?.spine) return results;

  const extractTextFromDocLike = (doc: unknown): string => {
    if (!doc) return '';
    if (typeof doc === 'string') {
      const parser = new DOMParser();
      const parsedDoc = parser.parseFromString(doc, 'text/html');
      return parsedDoc.body?.textContent || '';
    }
    if (doc instanceof Document) {
      return doc.body?.textContent || doc.documentElement?.textContent || '';
    }
    const anyDoc = doc as any;
    return anyDoc.body?.textContent || anyDoc.documentElement?.textContent || '';
  };

  const spineItems = book.spine.spineItems || book.spine.items || [];
  for (let i = 0; i < spineItems.length; i++) {
    if (isCancelled()) return results;
    if (results.length >= 50) break;

    const item = spineItems[i];
    try {
      let text = '';

      if (item.find) {
        try {
          const findResults = await item.find(searchQuery);
          if (findResults && findResults.length > 0) {
            for (const fr of findResults.slice(0, 3)) {
              results.push({
                cfi: fr.cfi ?? item.href ?? item.url ?? `section_${i}`,
                excerpt: fr.excerpt || searchQuery,
                section: item.idref || `Chapter ${i + 1}`,
              });
            }
            continue;
          }
        } catch (error) {
          logger.debug('item.find failed', error);
        }
      }

      if (item.load) {
        try {
          let doc: unknown = null;
          try {
            doc = await item.load(book.load?.bind(book));
          } catch (error) {
            logger.debug('item.load(loader) failed', error);
          }

          if (!doc && item.document) doc = item.document;

          text = extractTextFromDocLike(doc);
        } catch (error) {
          logger.debug('item.load failed', error);
        }
      }

      if (!text && book.archive) {
        const href = item.href || item.url;

        if (href && book.archive.getText) {
          try {
            const content = await book.archive.getText(href);
            if (content) {
              text = extractTextFromDocLike(content);
            }
          } catch (error) {
            logger.debug('archive.getText failed', { href }, error);
          }
        }

        if (!text && href && book.archive.request) {
          try {
            const content = await book.archive.request(href, 'text');
            if (content) {
              text = extractTextFromDocLike(content);
            }
          } catch (error) {
            logger.debug('archive.request failed', { href }, error);
          }
        }
      }

      if (!text && book.load && item.href) {
        try {
          const content = await book.load(item.href);
          text = extractTextFromDocLike(content);
        } catch (error) {
          logger.debug('book.load failed', { href: item.href }, error);
        }
      }

      if (!text || text.trim().length === 0) continue;

      const cleanText = text.replace(/\s+/g, ' ').trim();
      const lowerText = cleanText.toLowerCase();

      let searchIndex = 0;
      let foundIndex = lowerText.indexOf(query, searchIndex);
      let matchCount = 0;

      while (foundIndex !== -1 && results.length < 50 && matchCount < 3) {
        if (isCancelled()) return results;

        const start = Math.max(0, foundIndex - 50);
        const end = Math.min(cleanText.length, foundIndex + query.length + 50);
        let excerpt = cleanText.substring(start, end).trim();
        if (start > 0) excerpt = '...' + excerpt;
        if (end < cleanText.length) excerpt = excerpt + '...';

        const href = item.href || item.url || `section_${i}`;
        results.push({
          cfi: href,
          excerpt,
          section: item.idref || item.label || `Chapter ${i + 1}`,
        });

        matchCount++;
        searchIndex = foundIndex + query.length;
        foundIndex = lowerText.indexOf(query, searchIndex);
      }

      if (item.unload) {
        try {
          item.unload();
        } catch (error) {
          logger.debug('item.unload failed', error);
        }
      }
    } catch (error) {
      logger.warn('search section failed', { index: i, href: item?.href ?? item?.url }, error);
    }
  }

  return results;
}
