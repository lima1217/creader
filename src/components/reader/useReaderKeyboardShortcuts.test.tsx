import { describe, expect, it, beforeEach, vi } from 'vitest';
import { mount } from '../testUtils';
import { useReaderKeyboardShortcuts } from './useReaderKeyboardShortcuts';

function dispatchKey(key: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

function Harness({
  enabled,
  onPrev,
  onNext,
  onChapterStart,
  onChapterEnd,
}: {
  enabled: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  onChapterStart?: () => void;
  onChapterEnd?: () => void;
}) {
  useReaderKeyboardShortcuts({
    enabled,
    onPrev,
    onNext,
    onChapterStart,
    onChapterEnd,
  });
  return null;
}

describe('useReaderKeyboardShortcuts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('maps prev keys to onPrev', () => {
    const onPrev = vi.fn();
    mount(<Harness enabled onPrev={onPrev} onNext={vi.fn()} />);

    for (const key of ['ArrowLeft', 'PageUp'] as const) {
      onPrev.mockClear();
      dispatchKey(key);
      expect(onPrev).toHaveBeenCalledOnce();
    }

    onPrev.mockClear();
    dispatchKey(' ', { shiftKey: true });
    expect(onPrev).toHaveBeenCalledOnce();
  });

  it('maps next keys to onNext', () => {
    const onNext = vi.fn();
    mount(<Harness enabled onPrev={vi.fn()} onNext={onNext} />);

    for (const key of ['ArrowRight', 'PageDown', ' '] as const) {
      onNext.mockClear();
      dispatchKey(key);
      expect(onNext).toHaveBeenCalledOnce();
    }
  });

  it('does not map vertical arrow keys', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    mount(<Harness enabled onPrev={onPrev} onNext={onNext} />);

    dispatchKey('ArrowUp');
    dispatchKey('ArrowDown');

    expect(onPrev).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('maps Home and End to chapter edge handlers', () => {
    const onChapterStart = vi.fn();
    const onChapterEnd = vi.fn();
    mount(<Harness
      enabled
      onPrev={vi.fn()}
      onNext={vi.fn()}
      onChapterStart={onChapterStart}
      onChapterEnd={onChapterEnd}
    />);

    dispatchKey('Home');
    expect(onChapterStart).toHaveBeenCalledOnce();

    dispatchKey('End');
    expect(onChapterEnd).toHaveBeenCalledOnce();
  });

  it('ignores shortcuts when an editable target is focused', () => {
    const onNext = vi.fn();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    mount(<Harness enabled onNext={onNext} onPrev={vi.fn()} />);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(onNext).not.toHaveBeenCalled();
  });

  it('does not register listeners when disabled', () => {
    const onNext = vi.fn();
    mount(<Harness enabled={false} onNext={onNext} onPrev={vi.fn()} />);

    dispatchKey('ArrowRight');
    expect(onNext).not.toHaveBeenCalled();
  });
});
