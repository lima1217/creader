import { describe, expect, it } from 'vitest';
import { computeChapterRemainingPercent, computeEpubPercentage } from './epubProgress';

describe('computeChapterRemainingPercent', () => {
  it('returns remaining percent from section fraction', () => {
    expect(computeChapterRemainingPercent(0)).toBe(100);
    expect(computeChapterRemainingPercent(0.38)).toBe(62);
    expect(computeChapterRemainingPercent(1)).toBe(0);
  });

  it('clamps out-of-range fractions', () => {
    expect(computeChapterRemainingPercent(-0.2)).toBe(100);
    expect(computeChapterRemainingPercent(1.2)).toBe(0);
  });

  it('returns null when section fraction is unavailable', () => {
    expect(computeChapterRemainingPercent(null)).toBeNull();
    expect(computeChapterRemainingPercent(undefined)).toBeNull();
    expect(computeChapterRemainingPercent(Number.NaN)).toBeNull();
  });
});

describe('computeEpubPercentage', () => {
  it('reads book-wide percentage from location.start', () => {
    expect(computeEpubPercentage({
      location: { start: { percentage: 0.62 } },
      cfi: 'epubcfi(/6/4)',
    })).toBe(62);
  });
});
