export function computeChapterRemainingPercent(
  sectionFraction: number | null | undefined,
): number | null {
  if (sectionFraction === null || sectionFraction === undefined || !Number.isFinite(sectionFraction)) {
    return null;
  }

  const clamped = Math.min(1, Math.max(0, sectionFraction));
  return Math.round((1 - clamped) * 100);
}

export function computeEpubPercentage(params: {
  location: any;
  cfi: string | null;
}): number {
  const { location } = params;

  let percentage = 0;

  if (location?.start?.percentage !== undefined) {
    percentage = location.start.percentage * 100;
  } else if (location?.end?.percentage !== undefined) {
    percentage = location.end.percentage * 100;
  }

  if (percentage === 0 && location?.atEnd) {
    percentage = 100;
  }

  return percentage;
}
