import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach } from 'vitest';
import type { ReactElement } from 'react';

/**
 * Shared test harness primitives for Astryx Phase 2 component tests.
 *
 * Extracted from `Sidebar.test.tsx` during the #24 hardening so that
 * SelectionToolbar (#25) and AIPanel (#26) reuse the same mount/settle/input
 * helpers instead of duplicating the `createRoot` + `flushSync` lifecycle
 * (Phase 1 contract-mock precedent: `AppDialog.test.tsx`).
 *
 * WHAT LIVES HERE: runtime primitives — mount/settle/setInputValue/click,
 * jsdom polyfills (IntersectionObserver, ResizeObserver), and the afterEach
 * root-cleanup. These are safe to import because they are read at RUNTIME.
 *
 * WHAT DOES NOT LIVE HERE: vi.mock() calls and vi.mock factory bodies.
 * vi.mock is hoisted *per file*: a vi.mock declared in this shared module
 * does not register against a consuming test file's module graph, and a mock
 * factory body that references an imported binding trips the hoist TDZ.
 * Each test file must declare its own vi.mock(...) inline, using vi.hoisted()
 * for any state the mock body needs (see Sidebar.test.tsx for the confirm()
 * pattern). The mock-body reference recipes at the bottom of this file are
 * documentation only.
 */

// --- jsdom environment polyfills ----------------------------------------

/**
 * jsdom does not provide IntersectionObserver. Several reader surfaces use it
 * (LazyBookCover lazy-loads covers). The stub makes elements immediately
 * "visible" — it does not affect any chrome contract under test.
 */
export function installIntersectionObserverStub() {
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
}

/**
 * jsdom does not provide ResizeObserver. Install only when a test renders a
 * component that observes its own size (Astryx components may).
 */
export function installResizeObserverStub() {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
}

/**
 * jsdom has HTMLDialogElement but does not implement showModal()/close().
 * Astryx Dialog relies on those browser APIs, so component tests that render
 * real Dialogs need the minimal open-state behavior.
 */
export function installDialogElementStub() {
  window.scrollTo = () => {};

  const proto = window.HTMLDialogElement?.prototype;
  if (!proto) return;

  if (!proto.showModal) {
    proto.showModal = function showModal() {
      this.open = true;
      this.setAttribute('open', '');
    };
  }

  if (!proto.close) {
    proto.close = function close() {
      this.open = false;
      this.removeAttribute('open');
    };
  }

  const popoverProto = window.HTMLElement.prototype as HTMLElement & {
    showPopover?: () => void;
    hidePopover?: () => void;
    togglePopover?: () => void;
  };

  popoverProto.showPopover ??= function showPopover(this: HTMLElement) {
    this.setAttribute('popover-open', '');
  };
  popoverProto.hidePopover ??= function hidePopover(this: HTMLElement) {
    this.removeAttribute('popover-open');
  };
  popoverProto.togglePopover ??= function togglePopover(this: HTMLElement) {
    if (this.hasAttribute('popover-open')) {
      this.hidePopover?.();
      return false;
    } else {
      this.showPopover?.();
      return true;
    }
  };
}

// --- mount / settle / input ---------------------------------------------

const roots: Root[] = [];

/**
 * Render an element into a fresh container, flush synchronously, and return
 * the container + root. Roots are auto-unmounted in afterEach.
 */
export function mount(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  flushSync(() => {
    root.render(node);
  });
  return { container, root };
}

/** Flush pending effects + microtasks. */
export async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  flushSync(() => {});
}

/**
 * Set a value on a React-controlled input or textarea so onChange fires.
 * React 18 reads from the native value setter, not the property, for controlled
 * inputs — and the setter is element-type-specific (HTMLInputElement vs
 * HTMLTextAreaElement), so pick the right prototype.
 */
export function setInputValue(element: Element, value: string): void {
  const proto = element instanceof window.HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Dispatch a click as a user would (bubbling MouseEvent). Centralized so the
 * event shape is consistent across tests.
 */
export function click(element: Element): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

afterEach(() => {
  while (roots.length) {
    const r = roots.pop()!;
    try {
      flushSync(() => r.unmount());
    } catch {
      /* root already unmounted — safe to ignore during teardown */
    }
  }
  document.body.innerHTML = '';
});

// --- mock-body reference recipes (NOT imported — inline these) -----------
//
// These are NOT exported. They exist as a copy-paste reference for the mock
// bodies each test file inlines in its own vi.mock(...) calls. Copy the shape
// into your test file; do not import it.
//
// vi.mock('../services/CoverStore', () => ({
//   getCoverUrl: () => Promise.resolve(null),
//   deleteCover: () => Promise.resolve(undefined),
//   revokeCoverUrl: () => {},
//   setCoverUrl: () => {},
//   setCoverData: () => {},
// }));
//
// vi.mock('../utils/logger', () => ({
//   createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
// }));
//
// For a controlled confirm() (Sidebar uses this), use vi.hoisted():
//
//   const { getNextResult, setNextConfirmResult, resetConfirmState,
//           getConfirmCalls, recordCall } = vi.hoisted(() => { ... });
//   vi.mock('./AppDialog', () => ({
//     AppDialogProvider: ({ children }) => children,
//     useAppDialog: () => ({
//       confirm: (opts) => { recordCall(opts); return Promise.resolve(getNextResult()); },
//       notice: () => {},
//     }),
//   }));
