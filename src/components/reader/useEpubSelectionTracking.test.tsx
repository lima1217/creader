import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { useEpubSelectionTracking } from './useEpubSelectionTracking';

function createRendition() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    off: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    },
    emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.forEach(listener => listener(...args));
    },
  };
}

function Harness({
  rendition,
  handlers,
}: {
  rendition: ReturnType<typeof createRendition>;
  handlers: {
    setSelectedText: ReturnType<typeof vi.fn>;
    setSelectedCfiRange: ReturnType<typeof vi.fn>;
    setSelectionToolbarPos: ReturnType<typeof vi.fn>;
    setShowSelectionToolbar: ReturnType<typeof vi.fn>;
  };
}) {
  useEpubSelectionTracking({
    rendition: rendition as unknown as ReaderRendition,
    setSelectedText: handlers.setSelectedText,
    setSelectedCfiRange: handlers.setSelectedCfiRange,
    setSelectionToolbarPos: handlers.setSelectionToolbarPos,
    setShowSelectionToolbar: handlers.setShowSelectionToolbar,
    setShowSelectionHint: () => {},
  });

  return null;
}

describe('useEpubSelectionTracking', () => {
  beforeEach(() => {
    localStorage.removeItem('creader_selection_hint_seen');
  });

  it('shows the toolbar when the engine emits a non-empty selection with a position', () => {
    const rendition = createRendition();
    const iframe = document.createElement('iframe');
    vi.spyOn(iframe, 'getBoundingClientRect').mockReturnValue({
      left: 100, top: 50, width: 500, height: 600, right: 600, bottom: 650, x: 100, y: 50,
      toJSON: () => ({}),
    } as DOMRect);
    const range = {
      getBoundingClientRect: () => ({
        left: 20, top: 80, width: 120, height: 20, right: 140, bottom: 100, x: 20, y: 80,
        toJSON: () => ({}),
      }),
    } as Range;
    const selection = {
      rangeCount: 1, getRangeAt: () => range, toString: () => 'highlighted',
    } as unknown as Selection;
    const win = {
      getSelection: () => selection, frameElement: iframe, innerWidth: 1280,
    } as unknown as Window;

    const handlers = {
      setSelectedText: vi.fn(),
      setSelectedCfiRange: vi.fn(),
      setSelectionToolbarPos: vi.fn(),
      setShowSelectionToolbar: vi.fn(),
    };

    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => root.render(<Harness rendition={rendition} handlers={handlers} />));

    rendition.emit('selected', 'epubcfi(/6/4)', { window: win, document: {} });

    expect(handlers.setSelectedText).toHaveBeenCalledWith('highlighted');
    expect(handlers.setSelectedCfiRange).toHaveBeenCalledWith('epubcfi(/6/4)');
    expect(handlers.setShowSelectionToolbar).toHaveBeenCalledWith(true);
    expect(handlers.setSelectionToolbarPos).toHaveBeenCalledWith({ x: 180, y: 120 });

    flushSync(() => root.unmount());
  });

  it('dismisses the toolbar and clears selection state on selectionCleared', () => {
    const rendition = createRendition();
    const handlers = {
      setSelectedText: vi.fn(),
      setSelectedCfiRange: vi.fn(),
      setSelectionToolbarPos: vi.fn(),
      setShowSelectionToolbar: vi.fn(),
    };

    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => root.render(<Harness rendition={rendition} handlers={handlers} />));

    rendition.emit('selectionCleared');

    expect(handlers.setShowSelectionToolbar).toHaveBeenCalledWith(false);
    expect(handlers.setSelectionToolbarPos).toHaveBeenCalledWith(null);
    expect(handlers.setSelectedText).toHaveBeenCalledWith('');

    flushSync(() => root.unmount());
  });

  // Regression: the engine emits `selected` on every selection change while the
  // user drags. The store must end up holding the FINAL (full) text, not the
  // first character from when the drag started.
  it('tracks the final selection text as the user extends the drag', () => {
    const rendition = createRendition();
    const iframe = document.createElement('iframe');
    vi.spyOn(iframe, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 500, height: 600, right: 500, bottom: 600, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const range = {
      getBoundingClientRect: () => ({ left: 10, top: 10, width: 40, height: 20, right: 50, bottom: 30, x: 10, y: 10, toJSON: () => ({}) }),
    } as Range;

    const handlers = {
      setSelectedText: vi.fn(),
      setSelectedCfiRange: vi.fn(),
      setSelectionToolbarPos: vi.fn(),
      setShowSelectionToolbar: vi.fn(),
    };

    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => root.render(<Harness rendition={rendition} handlers={handlers} />));

    // Simulate preview events during drag (no CFI) followed by commit.
    const emitPreview = (text: string) => {
      const selection = {
        rangeCount: 1, getRangeAt: () => range, toString: () => text,
      } as unknown as Selection;
      const win = { getSelection: () => selection, frameElement: iframe, innerWidth: 1280 } as unknown as Window;
      rendition.emit('selected', '', { window: win, document: {} });
    };

    emitPreview('你');
    emitPreview('你好');
    emitPreview('你好世界');
    rendition.emit('selected', 'epubcfi(/6/4)', {
      window: { getSelection: () => ({ rangeCount: 1, getRangeAt: () => range, toString: () => '你好世界' }) as unknown as Selection, frameElement: iframe, innerWidth: 1280 } as unknown as Window,
      document: {},
    });

    const textCalls = handlers.setSelectedText.mock.calls.map(c => c[0]);
    expect(textCalls).toEqual(['你', '你好', '你好世界']);
    expect(handlers.setSelectedText).toHaveBeenLastCalledWith('你好世界');
    expect(handlers.setSelectedCfiRange.mock.calls).toEqual([[''], [''], [''], ['epubcfi(/6/4)']]);

    flushSync(() => root.unmount());
  });

  it('clears a committed CFI while previewing a new selection', () => {
    const rendition = createRendition();
    const iframe = document.createElement('iframe');
    vi.spyOn(iframe, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 500, height: 600, right: 500, bottom: 600, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const range = {
      getBoundingClientRect: () => ({ left: 10, top: 10, width: 40, height: 20, right: 50, bottom: 30, x: 10, y: 10, toJSON: () => ({}) }),
    } as Range;

    const handlers = {
      setSelectedText: vi.fn(),
      setSelectedCfiRange: vi.fn(),
      setSelectionToolbarPos: vi.fn(),
      setShowSelectionToolbar: vi.fn(),
    };

    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => root.render(<Harness rendition={rendition} handlers={handlers} />));

    const emitPreview = (text: string) => {
      const selection = {
        rangeCount: 1, getRangeAt: () => range, toString: () => text,
      } as unknown as Selection;
      const win = { getSelection: () => selection, frameElement: iframe, innerWidth: 1280 } as unknown as Window;
      rendition.emit('selected', '', { window: win, document: {} });
    };

    emitPreview('first');
    rendition.emit('selected', 'epubcfi(/6/2)', {
      window: { getSelection: () => ({ rangeCount: 1, getRangeAt: () => range, toString: () => 'first' }) as unknown as Selection, frameElement: iframe, innerWidth: 1280 } as unknown as Window,
      document: {},
    });
    emitPreview('second');

    expect(handlers.setSelectedCfiRange).toHaveBeenLastCalledWith('');
    expect(handlers.setSelectedText).toHaveBeenLastCalledWith('second');

    flushSync(() => root.unmount());
  });
});
