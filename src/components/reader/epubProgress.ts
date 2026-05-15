export function computeEpubPercentage(params: {
  location: any;
  cfi: string | null;
  bookAny: any;
}): number {
  const { location, cfi, bookAny } = params;

  let percentage = 0;

  if (location?.start?.percentage !== undefined) {
    percentage = location.start.percentage * 100;
  } else if (location?.end?.percentage !== undefined) {
    percentage = location.end.percentage * 100;
  }

  if (percentage === 0 && location?.atEnd) {
    percentage = 100;
  }

  if (percentage === 0 && cfi && bookAny?.locations) {
    try {
      if (
        typeof bookAny.locations.length === 'function' &&
        typeof bookAny.locations.percentageFromCfi === 'function'
      ) {
        const locLength = bookAny.locations.length();
        if (locLength > 0) {
          percentage = bookAny.locations.percentageFromCfi(cfi) * 100;
        }
      }
    } catch {
    }
  }

  if (percentage === 0 && location?.start?.index !== undefined && bookAny?.spine) {
    const spineLength = bookAny.spine.length || bookAny.spine.spineItems?.length || 1;
    percentage = ((location.start.index + 1) / spineLength) * 100;
  }

  return percentage;
}
