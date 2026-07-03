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

  const TOOLBAR_WIDTH = 260;
  const TOOLBAR_HEIGHT = 48;
  const VIEWPORT_MARGIN = 8;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
  const renderedX = viewportWidth > 0
    ? Math.max(TOOLBAR_WIDTH / 2 + VIEWPORT_MARGIN, Math.min(position.x, viewportWidth - TOOLBAR_WIDTH / 2 - VIEWPORT_MARGIN))
    : position.x;
  const renderedY = viewportHeight > 0
    ? Math.max(TOOLBAR_HEIGHT + VIEWPORT_MARGIN, Math.min(position.y, viewportHeight - VIEWPORT_MARGIN))
    : position.y;

  // If the hint would overflow the bottom of the viewport, render it above the
  // toolbar instead of always 60px below it.
  const HINT_HEIGHT = 32;
  const hintOffset = 60;
  const placeHintAbove =
    typeof window !== 'undefined' &&
    renderedY + hintOffset + HINT_HEIGHT > window.innerHeight;
  const hintTop = placeHintAbove
    ? renderedY - hintOffset
    : renderedY + hintOffset;

  return (
    <>
      <div
        className="reader-selection-toolbar"
        style={{
          left: `${renderedX}px`,
          top: `${renderedY}px`,
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
            left: `${renderedX}px`,
            top: `${hintTop}px`,
          }}
        >
          可先加入多段选文，再一起询问 AI
        </div>
      )}
    </>
  );
}
