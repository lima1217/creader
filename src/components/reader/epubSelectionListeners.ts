type SelectionPoint = { x: number; y: number };

/**
 * Compute the viewport-space position for a reading-engine selection
 * (Selection Coordinate, see CONTEXT.md).
 *
 * The Reading Engine Adapter (foliate-js) hosts each section's content inside
 * an `<iframe>` buried under two closed shadow roots, so the host page cannot
 * reach it with `querySelector`. `win.frameElement` resolves the host iframe
 * from inside the iframe's own window and crosses the shadow boundary because
 * foliate sandboxes the iframe with `allow-same-origin`. `range.rect` is in the
 * iframe's local viewport; adding `frameElement.rect` lifts it to top-page
 * coordinates, which is what the SelectionToolbar consumes.
 */
export function getSelectionPosition(win: Window): SelectionPoint | null {
  const selection = win.getSelection();
  const text = selection?.toString().trim() || '';
  if (!selection || !text) return null;

  let range: Range | null = null;
  try {
    range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  } catch {
    range = null;
  }

  const iframe = win.frameElement as HTMLIFrameElement | null;
  if (!range || !iframe) return null;

  const rect = range.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return null;

  const iframeRect = iframe.getBoundingClientRect();
  let x = iframeRect.left + rect.left + rect.width / 2;
  let y = iframeRect.top + rect.top - 10;

  const TOOLBAR_WIDTH = 250;
  const TOOLBAR_HEIGHT = 48;
  x = Math.max(TOOLBAR_WIDTH / 2, Math.min(x, window.innerWidth - TOOLBAR_WIDTH / 2));
  y = Math.max(TOOLBAR_HEIGHT + 10, y);

  return { x, y };
}
