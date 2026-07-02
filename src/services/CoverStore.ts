import { createLogger } from '../utils/logger';
import { db } from './DexieDb';

const urlCache = new Map<string, string>();
const logger = createLogger('CoverStore');
const MAX_URL_CACHE_ENTRIES = 200;

export async function saveCover(bookId: string, blob: Blob): Promise<void> {
  logger.debug('Saving cover for book:', bookId, ', blob size:', blob.size, 'bytes');
  revokeCoverUrl(bookId);
  await db.covers.put(blob, bookId);
  logger.debug('Cover saved successfully for:', bookId);
}

export async function loadCover(bookId: string): Promise<Blob | null> {
  logger.debug('Loading cover for book:', bookId);
  const result = await db.covers.get(bookId) ?? null;
  logger.debug('Cover loaded for:', bookId, ', found:', !!result, result ? `, size: ${result.size} bytes` : '');
  return result;
}

export async function deleteCover(bookId: string): Promise<void> {
  revokeCoverUrl(bookId);
  await db.covers.delete(bookId);
}

export async function getCoverUrl(bookId: string): Promise<string | null> {
  logger.debug('Getting cover URL for:', bookId);
  const cached = urlCache.get(bookId);
  if (cached) {
    logger.debug('Using cached URL for:', bookId);
    return cached;
  }

  const blob = await loadCover(bookId);
  if (!blob) {
    logger.debug('No blob found for:', bookId);
    return null;
  }

  const url = URL.createObjectURL(blob);
  urlCache.set(bookId, url);
  while (urlCache.size > MAX_URL_CACHE_ENTRIES) {
    const oldestKey = urlCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldestUrl = urlCache.get(oldestKey);
    if (oldestUrl) URL.revokeObjectURL(oldestUrl);
    urlCache.delete(oldestKey);
  }
  logger.debug('Created object URL for:', bookId, ', URL:', url);
  return url;
}

export function revokeCoverUrl(bookId: string): void {
  const url = urlCache.get(bookId);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(bookId);
  }
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}
