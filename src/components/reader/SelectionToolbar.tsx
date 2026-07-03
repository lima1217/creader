import type { ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';

/**
 * Selection toolbar — the floating chrome that appears over a reading-engine
 * selection. See ADR 0011 §7 and the "Selection Coordinate" term in
 * CONTEXT.md.
 *
 * The positioning shell, viewport-flip logic, and onMouseDown stop-propagation
 * stay as bespoke JSX: the Reading Engine Adapter emits an `{x, y}` coordinate,
 * never a DOM anchor, so Astryx trigger-anchored overlays (Popover/Tooltip)
 * cannot own this surface. Only the inner buttons + hint styling move to
 * Astryx tokens/components.
 */
export function SelectionToolbar(props: {
  visible: boolean;
  selectedText: string;
  position: { x: number; y: number } | null;
  accumulatedCount: number;
  addIcon: ReactNode;
  askIcon: ReactNode;
  closeIcon: ReactNode;
  onAdd: () => void;
  onAsk: () => void;
  onClose: () => void;
  showHint: boolean;
}) {
  const {
    visible,
    selectedText,
    position,
    accumulatedCount,
    addIcon,
    askIcon,
    closeIcon,
    onAdd,
    onAsk,
    onClose,
    showHint,
  } = props;

  if (!visible || !selectedText || !position) return null;

  // If the hint would overflow the bottom of the viewport, render it above the
  // toolbar instead of always 60px below it.
  const HINT_HEIGHT = 32;
  const hintOffset = 60;
  const placeHintAbove =
    typeof window !== 'undefined' &&
    position.y + hintOffset + HINT_HEIGHT > window.innerHeight;
  const hintTop = placeHintAbove
    ? position.y - hintOffset
    : position.y + hintOffset;

  return (
    <>
      <div
        className="reader-selection-toolbar"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Button
          variant="ghost"
          size="sm"
          label="加入选文"
          icon={addIcon}
          onClick={onAdd}
        >
          {accumulatedCount > 0 ? `加入选文 (${accumulatedCount})` : '加入选文'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          label="问 AI"
          icon={askIcon}
          onClick={onAsk}
        >
          问 AI
        </Button>
        <IconButton
          variant="ghost"
          size="sm"
          label="关闭"
          icon={closeIcon}
          onClick={onClose}
        />
      </div>
      {showHint && (
        <div
          className="reader-selection-hint"
          style={{
            left: `${position.x}px`,
            top: `${hintTop}px`,
          }}
        >
          可先加入多段选文，再一起询问 AI
        </div>
      )}
    </>
  );
}
