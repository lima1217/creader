import type { MouseEvent as ReactMouseEvent } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isTauriRuntime } from './tauri';

const INTERACTIVE_SELECTOR = [
    'button',
    'a',
    'input',
    'textarea',
    'select',
    'option',
    'label',
    'summary',
    '[role="button"]',
    '[contenteditable="true"]',
    '.astryx-button',
    '[role="menuitem"]',
    '.reader-content',
    'foliate-view',
    '.reader-search',
    '.reader-toc',
].join(', ');

export function handleWindowDragMouseDown(event: ReactMouseEvent<HTMLElement>) {
    if (!isTauriRuntime()) return;
    if (event.button !== 0 || event.detail > 1) return;

    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(INTERACTIVE_SELECTOR)) return;

    event.preventDefault();
    void getCurrentWebviewWindow().startDragging();
}
