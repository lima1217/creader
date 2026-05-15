import { createLogger } from './logger';

const logger = createLogger('perf');

function isPerfEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem('creader:perf') === '1';
  } catch {
    return false;
  }
}

export function perfMark(name: string): void {
  if (!isPerfEnabled()) return;
  if (!('performance' in window)) return;
  try {
    performance.mark(name);
  } catch (error) {
    logger.debug('perfMark failed', name, error);
  }
}

export function perfMeasure(name: string, startMark: string, endMark: string): void {
  if (!isPerfEnabled()) return;
  if (!('performance' in window)) return;
  try {
    performance.mark(endMark);
    const entry = performance.measure(name, startMark, endMark);
    logger.debug(name, `${Math.round(entry.duration)}ms`);
  } catch (error) {
    logger.debug('perfMeasure failed', name, error);
  }
}

export async function perfSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = `${name}:start`;
  const end = `${name}:end`;
  perfMark(start);
  try {
    return await fn();
  } finally {
    perfMeasure(name, start, end);
  }
}
