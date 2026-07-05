import { describe, expect, it } from 'vitest';
import {
  classifyBookOpenError,
  isReadingEngineLoadErrorMessage,
  toBookOpenUserMessage,
} from './errors';

describe('book open error classification', () => {
  it('detects reading-engine module load failures', () => {
    expect(isReadingEngineLoadErrorMessage('Failed to fetch dynamically imported module')).toBe(true);
    expect(isReadingEngineLoadErrorMessage('Failed to resolve module specifier "foliate-js/view.js"')).toBe(true);
    expect(classifyBookOpenError(new Error('Failed to fetch dynamically imported module'))).toBe('engine-load');
  });

  it('keeps file-not-found separate from engine-load failures', () => {
    expect(classifyBookOpenError(new Error('No such file or directory'))).toBe('not-found');
    expect(toBookOpenUserMessage(new Error('No such file or directory'))).toContain('找不到文件');
  });

  it('maps foliate parse failures to unsupported EPUB copy', () => {
    expect(classifyBookOpenError(new Error('foliate boom'))).toBe('unsupported');
    expect(toBookOpenUserMessage(new Error('foliate boom'))).toContain('CReader 当前不支持');
  });

  it('maps engine-load failures to rebuild guidance', () => {
    expect(toBookOpenUserMessage(new Error('Failed to fetch dynamically imported module'))).toContain('无法加载阅读引擎');
  });
});
