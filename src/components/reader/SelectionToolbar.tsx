import type { ReactNode } from 'react';

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
        <button
          className="reader-selection-btn"
          onClick={onAdd}
          title="Add to accumulated selection (continue selecting across pages)"
        >
          {addIcon}
          <span>Add ({accumulatedCount})</span>
        </button>
        <button className="reader-selection-btn" onClick={onAsk} title="Ask AI about selected text">
          {askIcon}
          <span>Ask AI</span>
        </button>
        <button className="reader-selection-btn reader-selection-btn-close" onClick={onClose} title="Close toolbar">
          {closeIcon}
        </button>
      </div>
      {showHint && (
        <div
          className="reader-selection-hint"
          style={{
            left: `${position.x}px`,
            top: `${position.y + 60}px`,
          }}
        >
          💡 Tip: Click "Add" to select across pages, then use AI
        </div>
      )}
    </>
  );
}

