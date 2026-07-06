import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEpubFileDropImport } from './useEpubFileDropImport';

vi.mock('../utils/tauri', () => ({
  isTauriRuntime: () => true,
}));

const roots: ReturnType<typeof createRoot>[] = [];

function mountHook() {
  const setIsDragging = vi.fn();
  const importBookFile = vi.fn().mockResolvedValue(undefined);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);

  function Probe() {
    useEpubFileDropImport(importBookFile, setIsDragging);
    return null;
  }

  flushSync(() => {
    root.render(createElement(Probe));
  });

  return { setIsDragging, importBookFile, container };
}

function dragEvent(type: string, types: string[] = ['Files']): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', {
    value: { types, files: [] },
  });
  return event;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    flushSync(() => {
      root?.unmount();
    });
  }
  document.body.innerHTML = '';
});

describe('useEpubFileDropImport', () => {
  it('clears dragging state on dragleave even when types are empty', () => {
    const { setIsDragging } = mountHook();

    window.dispatchEvent(dragEvent('dragenter'));
    expect(setIsDragging).toHaveBeenCalledWith(true);

    window.dispatchEvent(dragEvent('dragleave', []));
    expect(setIsDragging).toHaveBeenLastCalledWith(false);
  });

  it('ignores internal sidebar drags', () => {
    const { setIsDragging } = mountHook();

    window.dispatchEvent(
      dragEvent('dragenter', ['application/x-creader-book-id', 'text/plain']),
    );
    expect(setIsDragging).not.toHaveBeenCalled();
  });
});
