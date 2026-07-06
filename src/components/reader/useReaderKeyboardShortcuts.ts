import { useEffect } from 'react';
import { isEditableEventTarget } from '../../utils/dom';

export function useReaderKeyboardShortcuts(params: {
  enabled: boolean;
  isEditableTarget?: (target: EventTarget | null) => boolean;
  onPrev?: () => void;
  onNext?: () => void;
  onChapterStart?: () => void;
  onChapterEnd?: () => void;
  onEscape?: () => void;
  onKey?: (e: KeyboardEvent) => void;
}) {
  const {
    enabled,
    isEditableTarget,
    onPrev,
    onNext,
    onChapterStart,
    onChapterEnd,
    onEscape,
    onKey,
  } = params;

  useEffect(() => {
    if (!enabled) return;

    const isEditable = isEditableTarget ?? isEditableEventTarget;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;

      const isSpace = e.key === ' ' || e.key === 'Spacebar';
      const isShiftSpace = isSpace && e.shiftKey;

      if ((e.key === 'ArrowLeft' || e.key === 'PageUp' || isShiftSpace) && onPrev) {
        e.preventDefault();
        onPrev();
        return;
      }

      if ((e.key === 'ArrowRight' || e.key === 'PageDown' || (isSpace && !e.shiftKey)) && onNext) {
        e.preventDefault();
        onNext();
        return;
      }

      if (e.key === 'Home' && onChapterStart) {
        e.preventDefault();
        onChapterStart();
        return;
      }

      if (e.key === 'End' && onChapterEnd) {
        e.preventDefault();
        onChapterEnd();
        return;
      }

      if (e.key === 'Escape' && onEscape) {
        onEscape();
        return;
      }

      onKey?.(e);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, isEditableTarget, onChapterEnd, onChapterStart, onEscape, onKey, onNext, onPrev]);
}
