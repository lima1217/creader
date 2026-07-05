import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture toast calls so we can assert notice() routes through the toast
// channel without depending on Astryx's portal internals.
const toastMocks = vi.hoisted(() => ({
  toast: vi.fn(),
}));
vi.mock('@astryxdesign/core/Toast', () => ({
  useToast: () => toastMocks.toast,
  ToastViewport: () => null,
}));

// Stub Dialog so the test doesn't depend on a real <dialog> polyfill;
// we only assert the confirm() Promise + resolver wiring.
vi.mock('@astryxdesign/core/Dialog', () => ({
  Dialog: () => null,
  DialogHeader: () => null,
}));

import { AppDialogProvider, useAppDialog } from './AppDialog';

function Snapshotter({ onSnapshot }: { onSnapshot: (value: ReturnType<typeof useAppDialog>) => void }) {
  const dialog = useAppDialog();
  onSnapshot(dialog);
  return null;
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
}

describe('AppDialog contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes confirm() returning a Promise<boolean> and notice() returning void', async () => {
    let api: ReturnType<typeof useAppDialog> | null = null;
    const container = document.createElement('div');
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <AppDialogProvider>
          <Snapshotter onSnapshot={(value) => (api = value)} />
        </AppDialogProvider>,
      );
    });
    await settle();

    expect(typeof api!.confirm).toBe('function');
    expect(typeof api!.notice).toBe('function');

    const confirmPromise = api!.confirm({ title: 't', message: 'm' });
    expect(confirmPromise).toBeInstanceOf(Promise);

    // notice() returns no value (it now routes to the toast channel).
    expect(api!.notice({ title: 't', message: 'm' })).toBeUndefined();

    flushSync(() => root.unmount());
  });

  it('routes notice() through the toast channel (non-blocking, error type)', async () => {
    let api: ReturnType<typeof useAppDialog> | null = null;
    const container = document.createElement('div');
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <AppDialogProvider>
          <Snapshotter onSnapshot={(value) => (api = value)} />
        </AppDialogProvider>,
      );
    });
    await settle();

    api!.notice({ title: '无法导入 EPUB', message: '未知错误' });
    await settle();

    expect(toastMocks.toast).toHaveBeenCalledTimes(1);
    expect(toastMocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        body: '无法导入 EPUB：未知错误',
        type: 'error',
      }),
    );

    flushSync(() => root.unmount());
  });

  it('confirm() promise stays pending until the dialog is answered', async () => {
    let api: ReturnType<typeof useAppDialog> | null = null;
    const container = document.createElement('div');
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        <AppDialogProvider>
          <Snapshotter onSnapshot={(value) => (api = value)} />
        </AppDialogProvider>,
      );
    });
    await settle();

    let resolved: boolean | null = null;
    api!.confirm({ title: 't', message: 'm' }).then((result) => (resolved = result));
    await settle();

    // A second confirm() pre-resolves the first with false (replaces it),
    // matching the historical "any prior resolver is resolved with false" guard.
    api!.confirm({ title: 't2', message: 'm2' }).then((result) => (resolved = result));
    await settle();

    expect(resolved).toBe(false);

    flushSync(() => root.unmount());
  });
});
