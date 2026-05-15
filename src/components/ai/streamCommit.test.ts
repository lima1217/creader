import { describe, expect, it } from 'vitest';
import { createOnceCommitter } from './streamCommit';

describe('createOnceCommitter', () => {
  it('commits the first stream completion and ignores later fallbacks', () => {
    const committed: string[] = [];
    const commitOnce = createOnceCommitter((value: string) => committed.push(value));

    expect(commitOnce('translated text')).toBe(true);
    expect(commitOnce('translated text')).toBe(false);

    expect(committed).toEqual(['translated text']);
  });

  it('keeps the first completion when fallback and done race', () => {
    const committed: string[] = [];
    const commitOnce = createOnceCommitter((value: string) => committed.push(value));

    expect(commitOnce('fallback content')).toBe(true);
    expect(commitOnce('done content')).toBe(false);

    expect(committed).toEqual(['fallback content']);
  });
});
