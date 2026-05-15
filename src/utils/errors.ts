export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error('Unknown error');
  }
}

export function isNotFoundErrorMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('no such file') ||
    m.includes('os error 2') ||
    m.includes('not found') ||
    m.includes('does not exist') ||
    m.includes('enoent')
  );
}

export function isNotFoundError(err: unknown): boolean {
  const e = toError(err);
  return isNotFoundErrorMessage(e.message);
}

export function toUserMessage(err: unknown): string {
  const e = toError(err);
  const message = e.message || 'Unknown error';
  if (isNotFoundErrorMessage(message)) {
    return 'The file was not found. It may have been moved, renamed, or deleted.';
  }
  if (message.toLowerCase().includes('permission') || message.toLowerCase().includes('denied')) {
    return 'Permission denied. Please check file permissions.';
  }
  return message;
}
