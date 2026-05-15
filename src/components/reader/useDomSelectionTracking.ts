import { useEffect, useRef, useState } from 'react';

type Point = { x: number; y: number };

const DEFAULT_HINT_KEY = 'creader_selection_hint_seen';

export function useDomSelectionTracking<T extends HTMLElement>(params: {
  enabled: boolean;
  containerRef: React.RefObject<T | null>;
  onTextSelect?: (text: string) => void;
  resetKey?: unknown;
  effectKey?: unknown;
  hintStorageKey?: string;
  listenCopy?: boolean;
}) {
  const {
    enabled,
    containerRef,
    onTextSelect,
    resetKey,
    effectKey,
    hintStorageKey = DEFAULT_HINT_KEY,
    listenCopy = false,
  } = params;

  const lastEmittedSelectionRef = useRef('');
  const lastPointerPosRef = useRef<Point>({ x: 0, y: 0 });

  const [selectionToolbarPos, setSelectionToolbarPos] = useState<Point | null>(null);
  const [showSelectionToolbar, setShowSelectionToolbar] = useState(false);
  const [showSelectionHint, setShowSelectionHint] = useState(false);

  useEffect(() => {
    lastEmittedSelectionRef.current = '';
    setShowSelectionToolbar(false);
    setSelectionToolbarPos(null);
    setShowSelectionHint(false);
  }, [resetKey]);

  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    const isEditableNode = (node: Node | null) => {
      const el = node instanceof Element ? node : node?.parentElement;
      if (!el) return false;
      return Boolean(el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
    };

    const isSelectionWithinContainer = (selection: Selection, range: Range | null) => {
      if (range) {
        if (container.contains(range.startContainer) || container.contains(range.endContainer)) return true;
        if (container.contains(range.commonAncestorContainer)) return true;
      }

      if (selection.anchorNode && container.contains(selection.anchorNode)) return true;
      if (selection.focusNode && container.contains(selection.focusNode)) return true;
      return false;
    };

    const getSelectedText = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return null;

      const rawSelectedText = selection.toString();
      const activeTag = document.activeElement?.tagName;
      if ((activeTag === 'INPUT' || activeTag === 'TEXTAREA') && !rawSelectedText.trim()) {
        return null;
      }

      if (isEditableNode(selection.anchorNode) || isEditableNode(selection.focusNode)) {
        return null;
      }

      let range: Range | null = null;
      try {
        range = selection.getRangeAt(0);
      } catch {
        range = null;
      }

      if (!isSelectionWithinContainer(selection, range)) return null;

      const selectedText = rawSelectedText.trim();
      if (!selectedText) return '';

      return selectedText;
    };

    let rafId = 0;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let hintTimer: ReturnType<typeof setTimeout> | null = null;

    const positionToolbarFromRange = (range: Range) => {
      const rect = range.getBoundingClientRect();
      if (!(rect.width > 0 || rect.height > 0)) return false;

      let x = rect.left + rect.width / 2;
      let y = rect.top - 10;
      const toolbarWidth = 250;
      const toolbarHeight = 48;
      x = Math.max(toolbarWidth / 2, Math.min(x, window.innerWidth - toolbarWidth / 2));
      y = Math.max(toolbarHeight + 10, y);
      setSelectionToolbarPos({ x, y });
      setShowSelectionToolbar(true);
      return true;
    };

    const maybeShowHintOnce = () => {
      const hasSeenHint = localStorage.getItem(hintStorageKey);
      if (hasSeenHint) return;
      setShowSelectionHint(true);
      if (hintTimer) clearTimeout(hintTimer);
      hintTimer = setTimeout(() => setShowSelectionHint(false), 5000);
      localStorage.setItem(hintStorageKey, 'true');
    };

    const emitSelection = () => {
      const selectedText = getSelectedText();
      if (selectedText === null) return;
      if (selectedText === lastEmittedSelectionRef.current) return;

      lastEmittedSelectionRef.current = selectedText;
      onTextSelect?.(selectedText);

      if (!selectedText) {
        setShowSelectionToolbar(false);
        setSelectionToolbarPos(null);
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      let range: Range | null = null;
      try {
        range = selection.getRangeAt(0);
      } catch {
        range = null;
      }

      if (range && positionToolbarFromRange(range)) {
        maybeShowHintOnce();
        return;
      }

      if (lastPointerPosRef.current.x > 0) {
        setSelectionToolbarPos({ x: lastPointerPosRef.current.x, y: lastPointerPosRef.current.y - 40 });
        setShowSelectionToolbar(true);
        maybeShowHintOnce();
      }
    };

    const scheduleEmit = () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (debounceTimer) clearTimeout(debounceTimer);
      rafId = requestAnimationFrame(() => {
        debounceTimer = setTimeout(emitSelection, 50);
      });
    };

    let selectionChangeActive = false;
    let selectionChangeTimer: number | null = null;

    const disableSelectionChange = () => {
      if (!selectionChangeActive) return;
      selectionChangeActive = false;
      document.removeEventListener('selectionchange', scheduleEmit);
      if (selectionChangeTimer !== null) {
        clearTimeout(selectionChangeTimer);
        selectionChangeTimer = null;
      }
    };

    const enableSelectionChange = () => {
      if (!selectionChangeActive) {
        selectionChangeActive = true;
        document.addEventListener('selectionchange', scheduleEmit);
      }
      if (selectionChangeTimer !== null) clearTimeout(selectionChangeTimer);
      selectionChangeTimer = window.setTimeout(disableSelectionChange, 2000);
    };

    const onPointerMove = (e: PointerEvent | MouseEvent) => {
      lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
    };

    const onCopy = () => {
      scheduleEmit();
    };

    const onScroll = () => {
      // When user scrolls, they are back in "reading" mode.
      // Hide the toolbar but keep the selected text in store.
      setShowSelectionToolbar(false);
    };

    container.addEventListener('pointerup', scheduleEmit);
    container.addEventListener('mouseup', scheduleEmit);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('mousemove', onPointerMove);
    container.addEventListener('pointerdown', enableSelectionChange);
    container.addEventListener('scroll', onScroll, { passive: true });
    if (listenCopy) document.addEventListener('copy', onCopy);

    return () => {
      container.removeEventListener('pointerup', scheduleEmit);
      container.removeEventListener('mouseup', scheduleEmit);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('mousemove', onPointerMove);
      container.removeEventListener('pointerdown', enableSelectionChange);
      container.removeEventListener('scroll', onScroll);
      disableSelectionChange();
      if (listenCopy) document.removeEventListener('copy', onCopy);
      if (rafId) cancelAnimationFrame(rafId);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (hintTimer) clearTimeout(hintTimer);
    };
  }, [containerRef, effectKey, enabled, hintStorageKey, listenCopy, onTextSelect]);

  useEffect(() => {
    if (!enabled) return;
    if (!showSelectionToolbar) return;

    const onPointerDownCapture = (e: PointerEvent) => {
      const toolbar = document.querySelector('.reader-selection-toolbar');
      if (toolbar && e.target instanceof Node && toolbar.contains(e.target)) return;
      setShowSelectionToolbar(false);
    };

    document.addEventListener('pointerdown', onPointerDownCapture, true);
    return () => document.removeEventListener('pointerdown', onPointerDownCapture, true);
  }, [enabled, showSelectionToolbar]);

  return {
    selectionToolbarPos,
    showSelectionToolbar,
    showSelectionHint,
    setShowSelectionToolbar,
    setSelectionToolbarPos,
    setShowSelectionHint,
  };
}
