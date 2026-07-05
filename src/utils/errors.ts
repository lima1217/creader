export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error('未知错误');
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
  const message = e.message || '未知错误';
  if (isNotFoundErrorMessage(message)) {
    return '找不到文件。它可能已被移动、重命名或删除。';
  }
  if (message.toLowerCase().includes('permission') || message.toLowerCase().includes('denied')) {
    return '没有文件权限，请检查访问权限。';
  }
  return message;
}

export type BookOpenErrorKind = 'not-found' | 'engine-load' | 'unsupported';

export function isReadingEngineLoadErrorMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('failed to fetch dynamically imported module') ||
    m.includes('failed to resolve module specifier') ||
    m.includes('error loading dynamically imported module') ||
    m.includes('importing a module script failed') ||
    m.includes('foliate-js/view.js')
  );
}

export function classifyBookOpenError(err: unknown): BookOpenErrorKind {
  const message = toError(err).message;
  if (isNotFoundErrorMessage(message)) return 'not-found';
  if (isReadingEngineLoadErrorMessage(message)) return 'engine-load';
  return 'unsupported';
}

function unsupportedBookMessage(): string {
  return '无法打开书籍：这本 EPUB 可能使用了 CReader 当前不支持的格式或脚本内容。请尝试换一本标准 EPUB 文件。';
}

function readingEngineLoadMessage(): string {
  return '无法加载阅读引擎。请重新安装或重新构建 CReader；若问题仍在，请反馈给开发者。';
}

export function toBookOpenUserMessage(err: unknown): string {
  const kind = classifyBookOpenError(err);
  if (kind === 'not-found') return toUserMessage(err);
  if (kind === 'engine-load') return readingEngineLoadMessage();
  return unsupportedBookMessage();
}
