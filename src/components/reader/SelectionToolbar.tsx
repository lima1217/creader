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
          title="加入跨页选文"
        >
          {addIcon}
          <span>加入 ({accumulatedCount})</span>
        </button>
        <button className="reader-selection-btn" onClick={onAsk} title="用选文询问 AI">
          {askIcon}
          <span>问 AI</span>
        </button>
        <button className="reader-selection-btn reader-selection-btn-close" onClick={onClose} title="关闭">
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
          可先加入多段选文，再一起询问 AI
        </div>
      )}
    </>
  );
}
