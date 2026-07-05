/**
 * Whether a keyboard event target is a text-editing surface (input, textarea,
 * select, or a contenteditable element). Used to suppress reader/global
 * shortcuts while the user is typing.
 */
export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return target.isContentEditable;
}
