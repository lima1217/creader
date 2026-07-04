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
