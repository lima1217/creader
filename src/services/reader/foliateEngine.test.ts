import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyFoliateManagedStyles, toFoliateThemeCss, foliateEngineAdapter } from './foliateEngine';

vi.mock('foliate-js/view.js', () => ({}));

describe('foliateEngine theme bridge', () => {
  it('serializes theme rules as foliate-managed CSS', () => {
    const css = toFoliateThemeCss({
      body: {
        color: '#111 !important',
        background: '#fff !important',
      },
      a: {
        color: '#33526E !important',
      },
    });

    expect(css).toBe('body{color:#111 !important;background:#fff !important;}\na{color:#33526E !important;}');
  });

  it('uses foliate renderer.setStyles so theme switches refresh the paginator background layer', () => {
    const setStyles = vi.fn();
    const css = 'body{background:#FBF9F4 !important;}';

    const applied = applyFoliateManagedStyles({ setStyles, setAttribute: vi.fn(), removeAttribute: vi.fn() }, css);

    expect(applied).toBe(true);
    expect(setStyles).toHaveBeenCalledWith(css);
  });

  it('reports unmanaged renderers so callers can fall back to direct document style injection', () => {
    expect(applyFoliateManagedStyles(undefined, 'body{}')).toBe(false);
  });
});

describe('foliateEngine setLayout', () => {
  let mockRenderer: {
    setAttribute: ReturnType<typeof vi.fn>;
    removeAttribute: ReturnType<typeof vi.fn>;
    getContents?: () => Array<{ doc?: Document; index?: number }>;
    setStyles?: (styles: string) => void;
    addEventListener?: ReturnType<typeof vi.fn>;
    removeEventListener?: ReturnType<typeof vi.fn>;
  };

  let mockView: {
    renderer: typeof mockRenderer;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    lastLocation: unknown;
    open: ReturnType<typeof vi.fn>;
    init: ReturnType<typeof vi.fn>;
    goTo: ReturnType<typeof vi.fn>;
    prev: ReturnType<typeof vi.fn>;
    next: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    getCFI?: ReturnType<typeof vi.fn>;
    classList: { add: ReturnType<typeof vi.fn> };
    remove: ReturnType<typeof vi.fn>;
  };

  let originalCreateElement: typeof document.createElement;

  beforeEach(() => {
    mockRenderer = {
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      getContents: vi.fn(() => []),
      setStyles: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    mockView = {
      renderer: mockRenderer,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      lastLocation: null,
      open: vi.fn(),
      init: vi.fn(),
      goTo: vi.fn(),
      prev: vi.fn(),
      next: vi.fn(),
      close: vi.fn(),
      classList: { add: vi.fn() },
      remove: vi.fn(),
    };

    originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'foliate-view') return mockView as unknown as HTMLElement;
      return originalCreateElement(tag);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function openTestInstance() {
    return foliateEngineAdapter.open({
      appBook: { title: 'Test Book' } as any,
      arrayBuffer: new ArrayBuffer(0),
      container: document.createElement('div'),
    });
  }

  it('sets flow and max-inline-size and animated attribute when all options provided', async () => {
    const instance = await openTestInstance();

    instance.rendition.setLayout?.({ flow: 'scrolled', maxInlineSize: 700, animated: true });

    expect(mockRenderer.setAttribute).toHaveBeenCalledWith('flow', 'scrolled');
    expect(mockRenderer.setAttribute).toHaveBeenCalledWith('max-inline-size', '700px');
    expect(mockRenderer.setAttribute).toHaveBeenCalledWith('animated', '');
    expect(mockRenderer.removeAttribute).not.toHaveBeenCalled();
  });

  it('removes animated attribute when animated is false', async () => {
    const instance = await openTestInstance();

    instance.rendition.setLayout?.({ flow: 'scrolled', animated: false });

    expect(mockRenderer.setAttribute).toHaveBeenCalledWith('flow', 'scrolled');
    expect(mockRenderer.setAttribute).not.toHaveBeenCalledWith('animated', '');
    expect(mockRenderer.removeAttribute).toHaveBeenCalledWith('animated');
  });

  it('omits max-inline-size when not provided', async () => {
    const instance = await openTestInstance();

    instance.rendition.setLayout?.({ flow: 'scrolled' });

    expect(mockRenderer.setAttribute).toHaveBeenCalledWith('flow', 'scrolled');
    expect(mockRenderer.setAttribute).not.toHaveBeenCalledWith(
      expect.stringContaining('max-inline-size'),
      expect.anything(),
    );
  });

  it('does not throw when renderer is undefined', async () => {
    mockView.renderer = undefined as any;

    const instance = await openTestInstance();

    expect(() => instance.rendition.setLayout?.({ flow: 'scrolled' })).not.toThrow();
  });
});

describe('foliateEngine section typography', () => {
  let loadHandler: ((event: Event) => void) | undefined;

  let mockRenderer: {
    setAttribute: ReturnType<typeof vi.fn>;
    removeAttribute: ReturnType<typeof vi.fn>;
    getContents?: () => Array<{ doc?: Document; index?: number }>;
    setStyles?: (styles: string) => void;
    addEventListener?: ReturnType<typeof vi.fn>;
    removeEventListener?: ReturnType<typeof vi.fn>;
  };

  let mockView: {
    renderer: typeof mockRenderer;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    lastLocation: unknown;
    open: ReturnType<typeof vi.fn>;
    init: ReturnType<typeof vi.fn>;
    goTo: ReturnType<typeof vi.fn>;
    prev: ReturnType<typeof vi.fn>;
    next: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    getCFI?: ReturnType<typeof vi.fn>;
    classList: { add: ReturnType<typeof vi.fn> };
    remove: ReturnType<typeof vi.fn>;
  };

  let originalCreateElement: typeof document.createElement;

  beforeEach(() => {
    loadHandler = undefined;
    mockRenderer = {
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      getContents: vi.fn(() => []),
      setStyles: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    mockView = {
      renderer: mockRenderer,
      addEventListener: vi.fn((type: string, handler: (event: Event) => void) => {
        if (type === 'load') loadHandler = handler;
      }),
      removeEventListener: vi.fn(),
      lastLocation: null,
      open: vi.fn(),
      init: vi.fn(),
      goTo: vi.fn(),
      prev: vi.fn(),
      next: vi.fn(),
      close: vi.fn(),
      classList: { add: vi.fn() },
      remove: vi.fn(),
    };

    originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'foliate-view') return mockView as unknown as HTMLElement;
      return originalCreateElement(tag);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function openTestInstance() {
    return foliateEngineAdapter.open({
      appBook: { title: 'Test Book' } as any,
      arrayBuffer: new ArrayBuffer(0),
      container: document.createElement('div'),
    });
  }

  it('injects per-section typography CSS from document lang on load', async () => {
    const { buildSectionTypographyCss } = await import('./epubTypography');
    await openTestInstance();
    const doc = document.implementation.createHTMLDocument('section');
    doc.documentElement.lang = 'en';

    loadHandler?.(new CustomEvent('load', { detail: { doc, index: 0 } }));

    const style = doc.getElementById('creader-foliate-typography') as HTMLStyleElement | null;
    expect(style?.textContent).toBe(buildSectionTypographyCss('en'));
  });
});
