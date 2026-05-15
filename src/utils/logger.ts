type LogFn = (...args: unknown[]) => void;

let debugOverride: boolean | null = null;

function isDebugEnabled(): boolean {
  if (debugOverride !== null) return debugOverride;
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem('creader:debug') === '1';
  } catch {
    return false;
  }
}

export function setDebugEnabled(enabled: boolean | null) {
  debugOverride = enabled;
}

export function createLogger(scope: string) {
  const prefix = `[${scope}]`;

  const debug: LogFn = (...args) => {
    if (!isDebugEnabled()) return;
    console.debug(prefix, ...args);
  };

  const info: LogFn = (...args) => {
    if (!isDebugEnabled()) return;
    console.log(prefix, ...args);
  };

  const warn: LogFn = (...args) => {
    if (!isDebugEnabled()) return;
    console.warn(prefix, ...args);
  };

  const error: LogFn = (...args) => {
    console.error(prefix, ...args);
  };

  return { debug, info, warn, error };
}
