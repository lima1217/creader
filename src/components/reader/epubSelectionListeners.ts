import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { getRenditionContents, registerRenditionContentHook } from '../../services/reader/epubAdapter';

type SelectionPoint = { x: number; y: number };

export function getSelectionFromEpubContent(params: {
  win: Window;
  iframe: HTMLIFrameElement | null;
  lastMousePos: SelectionPoint;
}): { text: string; position: SelectionPoint | null } | null {
  const { win, iframe, lastMousePos } = params;
  const selection = win.getSelection();
  const text = selection?.toString().trim() || '';
  if (!selection || !text) return null;

  let range: Range | null = null;
  try {
    range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  } catch {
    range = null;
  }

  if (range && iframe) {
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      const iframeRect = iframe.getBoundingClientRect();
      let x = iframeRect.left + rect.left + rect.width / 2;
      let y = iframeRect.top + rect.top - 10;

      const toolbarWidth = 250;
      const toolbarHeight = 48;
      x = Math.max(toolbarWidth / 2, Math.min(x, window.innerWidth - toolbarWidth / 2));
      y = Math.max(toolbarHeight + 10, y);
      return { text, position: { x, y } };
    }
  }

  if (lastMousePos.x > 0) {
    return {
      text,
      position: { x: lastMousePos.x, y: lastMousePos.y - 40 },
    };
  }

  return { text, position: null };
}

export function setupEpubSelectionListeners(params: {
  rendition: ReaderRendition;
  containerRef: React.RefObject<HTMLElement | null>;
  lastMousePosRef: React.RefObject<{ x: number; y: number }>;
  startSelectionPolling: (durationMs: number) => void;
  updateSelectionFromWindow: (win: Window) => void;
  setShowSelectionToolbar: (show: boolean) => void;
}): () => void {
  const {
    rendition,
    containerRef,
    lastMousePosRef,
    startSelectionPolling,
    updateSelectionFromWindow,
    setShowSelectionToolbar,
  } = params;

  const selectionListenerByDoc = new Map<Document, () => void>();

  const pruneSelectionListeners = () => {
    for (const [doc, cleanup] of selectionListenerByDoc) {
      const frame = doc.defaultView?.frameElement;
      if (frame && !frame.isConnected) {
        cleanup();
        selectionListenerByDoc.delete(doc);
      }
    }
  };

  const cleanupSelectionListeners = () => {
    for (const [, cleanup] of selectionListenerByDoc) cleanup();
    selectionListenerByDoc.clear();
  };

  const attachToContent = (contents: { document?: Document; window?: Window }) => {
    try {
      const doc = contents.document;
      const win = contents.window;
      if (!doc || !win) return;
      pruneSelectionListeners();
      if (selectionListenerByDoc.has(doc)) return;

      const onMouseMove = (e: MouseEvent) => {
        const iframe = containerRef.current?.querySelector('iframe');
        if (!iframe) return;
        const iframeRect = iframe.getBoundingClientRect();
        lastMousePosRef.current = {
          x: iframeRect.left + e.clientX,
          y: iframeRect.top + e.clientY,
        };
      };

      const onMouseDown = (e: MouseEvent) => {
        setTimeout(() => {
          const selection = win.getSelection();
          if (!selection || selection.toString().trim()) return;
          const toolbarElement = document.querySelector('.reader-selection-toolbar');
          if (toolbarElement) {
            const toolbarRect = toolbarElement.getBoundingClientRect();
            const iframe = containerRef.current?.querySelector('iframe');
            if (iframe) {
              const iframeRect = iframe.getBoundingClientRect();
              const clickX = iframeRect.left + e.clientX;
              const clickY = iframeRect.top + e.clientY;
              if (
                clickX < toolbarRect.left - 20 ||
                clickX > toolbarRect.right + 20 ||
                clickY < toolbarRect.top - 20 ||
                clickY > toolbarRect.bottom + 20
              ) {
                setShowSelectionToolbar(false);
              }
            }
          } else {
            setShowSelectionToolbar(false);
          }
        }, 100);
      };

      const onMouseUp = () => {
        window.setTimeout(() => updateSelectionFromWindow(win), 10);
        startSelectionPolling(900);
      };

      const onSelectionChange = () => {
        updateSelectionFromWindow(win);
      };

      doc.addEventListener('mousemove', onMouseMove);
      doc.addEventListener('mousedown', onMouseDown);
      doc.addEventListener('mouseup', onMouseUp);
      doc.addEventListener('selectionchange', onSelectionChange);

      selectionListenerByDoc.set(doc, () => {
        doc.removeEventListener('mousemove', onMouseMove);
        doc.removeEventListener('mousedown', onMouseDown);
        doc.removeEventListener('mouseup', onMouseUp);
        doc.removeEventListener('selectionchange', onSelectionChange);
      });
    } catch {
    }
  };

  registerRenditionContentHook(rendition, attachToContent);

  for (const contents of getRenditionContents(rendition)) {
    attachToContent(contents);
  }

  return cleanupSelectionListeners;
}
