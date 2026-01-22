export async function loadOrGenerateLocations(book: any, bookId: string): Promise<void> {
  if (!book?.locations) return;

  const key = `creader-locations:${bookId}`;
  const saved = localStorage.getItem(key);

  if (saved && typeof book.locations.load === 'function') {
    await book.locations.load(saved);
    return;
  }

  if (typeof book.locations.generate !== 'function') return;
  await book.locations.generate(1600);

  if (typeof book.locations.save !== 'function') return;
  const serialized = book.locations.save();
  if (typeof serialized === 'string' && serialized.length > 0) {
    localStorage.setItem(key, serialized);
  }
}
