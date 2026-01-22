import type { ReaderSearchResult } from './types';

export async function searchBook(
  book: any,
  searchQuery: string,
  isCancelled: () => boolean
): Promise<ReaderSearchResult[]> {
  const results: ReaderSearchResult[] = [];
  const query = searchQuery.toLowerCase();

  if (!book?.spine) return results;

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
                cfi: fr.cfi || item.href,
                excerpt: fr.excerpt || searchQuery,
                section: item.idref || `Chapter ${i + 1}`,
              });
            }
            continue;
          }
        } catch {
        }
      }

      if (item.load) {
        try {
          let doc = null;
          try {
            doc = await item.load(book.load?.bind(book));
          } catch {
          }

          if (!doc && item.document) doc = item.document;

          if (doc) {
            if (doc.body) text = doc.body.textContent || '';
            else if (doc.documentElement) text = doc.documentElement.textContent || '';
          }
        } catch {
        }
      }

      if (!text && book.archive) {
        const href = item.href || item.url;

        if (book.archive.getText) {
          try {
            const content = await book.archive.getText(href);
            if (content) {
              const parser = new DOMParser();
              const parsedDoc = parser.parseFromString(content, 'text/html');
              text = parsedDoc.body?.textContent || '';
            }
          } catch {
          }
        }

        if (!text && book.archive.request) {
          try {
            const content = await book.archive.request(href, 'text');
            if (content) {
              const parser = new DOMParser();
              const parsedDoc = parser.parseFromString(content, 'text/html');
              text = parsedDoc.body?.textContent || '';
            }
          } catch {
          }
        }
      }

      if (!text && book.load && item.href) {
        try {
          const content = await book.load(item.href);
          if (typeof content === 'string') {
            const parser = new DOMParser();
            const parsedDoc = parser.parseFromString(content, 'text/html');
            text = parsedDoc.body?.textContent || '';
          } else if (content && content.body) {
            text = content.body.textContent || '';
          }
        } catch {
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
        } catch {
        }
      }
    } catch {
    }
  }

  return results;
}
