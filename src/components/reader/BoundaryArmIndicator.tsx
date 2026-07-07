import type { BoundaryArmDirection } from '../../services/reader/foliateEngine';
import './BoundaryArmIndicator.css';

export interface BoundaryArmIndicatorProps {
  /** When true the hint is visible (armed at a chapter edge). */
  visible: boolean;
  /** Which edge the reader is armed against. */
  direction: BoundaryArmDirection | null;
  /** Arm progress 0–1; fills the progress bar as scroll intent accumulates. */
  progress: number;
}

/**
 * Thin progress hairline shown while the reader is armed at a chapter boundary.
 * Sits at the bottom edge for "next" (boundary below, next chapter loads there)
 * and the top edge for "prev". Centered segment. Token-only styling.
 */
export function BoundaryArmIndicator({ visible, direction, progress }: BoundaryArmIndicatorProps) {
  const atTop = direction === 'prev';
  const filled = Math.max(0, Math.min(1, progress)) * 100;

  return (
    <div
      className={`reader-boundary-arm ${visible ? 'is-visible' : ''} ${atTop ? 'at-top' : 'at-bottom'}`}
      aria-hidden={!visible}
    >
      <span className="reader-boundary-arm-fill" style={{ width: `${filled}%` }} />
    </div>
  );
}
