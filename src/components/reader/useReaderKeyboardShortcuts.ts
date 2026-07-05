import { useEffect } from 'react';
import { isEditableEventTarget } from '../../utils/dom';

export function useReaderKeyboardShortcuts(params: {
  enabled: boolean;
  isEditableTarget?: (target: EventTarget | null) => boolean;
  onPrev?: () => void;
  onNext?: () => void;
  onEscape?: () => void;
  onKey?: (e: KeyboardEvent) => void;
}) {
  const { enabled, isEditableTarget, onPrev, onNext, onEscape, onKey } = params;

  useEffect(() => {
    if (!enabled) return;

    const isEditable = isEditableTarget ?? isEditableEventTarget;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;

      const isSpace = e.key === ' ' || e.key === 'Spacebar';
      const isShiftSpace = isSpace && e.shiftKey;

      if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp' || isShiftSpace) && onPrev) {
        e.preventDefault();
        onPrev();
        return;
      }

      if ((e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || isSpace) && onNext) {
        e.preventDefault();
        onNext();
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
  }, [enabled, isEditableTarget, onEscape, onKey, onNext, onPrev]);
}
