import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyFoliateManagedStyles,
  toFoliateThemeCss,
  foliateEngineAdapter,
  isScrolledAtBottom,
  isScrolledAtTop,
  shouldPrefetchAdjacentSections,
  findAdjacentLinearSectionIndex,
  SCROLLED_BOUNDARY_TOLERANCE_PX,
  SCROLLED_PREFETCH_DISTANCE_PX,
} from './foliateEngine';

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

describe('foliateEngine chapter edge navigation', () => {
  let mockRenderer: {
    setAttribute: ReturnType<typeof vi.fn>;
    removeAttribute: ReturnType<typeof vi.fn>;
    goTo: ReturnType<typeof vi.fn>;
    getContents: ReturnType<typeof vi.fn>;
    setStyles: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };

  let mockView: {
    renderer: typeof mockRenderer;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    lastLocation: { index: number } | null;
    open: ReturnType<typeof vi.fn>;
    init: ReturnType<typeof vi.fn>;
    goTo: ReturnType<typeof vi.fn>;
    prev: ReturnType<typeof vi.fn>;
    next: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    classList: { add: ReturnType<typeof vi.fn> };
    remove: ReturnType<typeof vi.fn>;
  };

  let originalCreateElement: typeof document.createElement;

  beforeEach(() => {
    mockRenderer = {
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      goTo: vi.fn(),
      getContents: vi.fn(() => []),
      setStyles: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    mockView = {
      renderer: mockRenderer,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      lastLocation: { index: 3 },
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

  it('goToChapterStart scrolls to the start of the current section', async () => {
    const instance = await openTestInstance();

    await instance.rendition.goToChapterStart?.();

    expect(mockRenderer.goTo).toHaveBeenCalledWith({
      index: 3,
      anchor: expect.any(Function),
    });
    expect(mockRenderer.goTo.mock.calls[0][0].anchor()).toBe(0);
  });

  it('goToChapterEnd scrolls to the end of the current section', async () => {
    const instance = await openTestInstance();

    await instance.rendition.goToChapterEnd?.();

    expect(mockRenderer.goTo).toHaveBeenCalledWith({
      index: 3,
      anchor: expect.any(Function),
    });
    expect(mockRenderer.goTo.mock.calls[0][0].anchor()).toBe(1);
  });

  it('skips chapter edge navigation when the current section is unknown', async () => {
    mockView.lastLocation = null;
    const instance = await openTestInstance();

    await instance.rendition.goToChapterStart?.();

    expect(mockRenderer.goTo).not.toHaveBeenCalled();
  });
});

describe('foliateEngine whole-book progress', () => {
  let mockView: {
    renderer: {
      setAttribute: ReturnType<typeof vi.fn>;
      removeAttribute: ReturnType<typeof vi.fn>;
      getContents: ReturnType<typeof vi.fn>;
      setStyles: ReturnType<typeof vi.fn>;
      addEventListener: ReturnType<typeof vi.fn>;
      removeEventListener: ReturnType<typeof vi.fn>;
    };
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    lastLocation: unknown;
    open: ReturnType<typeof vi.fn>;
    init: ReturnType<typeof vi.fn>;
    goTo: ReturnType<typeof vi.fn>;
    goToFraction: ReturnType<typeof vi.fn>;
    getSectionFractions: ReturnType<typeof vi.fn>;
    prev: ReturnType<typeof vi.fn>;
    next: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    classList: { add: ReturnType<typeof vi.fn> };
    remove: ReturnType<typeof vi.fn>;
  };

  let originalCreateElement: typeof document.createElement;

  beforeEach(() => {
    mockView = {
      renderer: {
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
        getContents: vi.fn(() => []),
        setStyles: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      lastLocation: null,
      open: vi.fn(),
      init: vi.fn(),
      goTo: vi.fn(),
      goToFraction: vi.fn(),
      getSectionFractions: vi.fn(() => [0, 0.25, 0.5, 0.75]),
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

  it('seekToFraction forwards to foliate view goToFraction', async () => {
    const instance = await openTestInstance();

    await instance.rendition.seekToFraction?.(0.5);

    expect(mockView.goToFraction).toHaveBeenCalledWith(0.5);
    expect(mockView.goTo).not.toHaveBeenCalled();
  });

  it('seekToFraction falls back to goTo({ fraction }) when goToFraction is unavailable', async () => {
    mockView.goToFraction = undefined as any;
    const instance = await openTestInstance();

    await instance.rendition.seekToFraction?.(0.42);

    expect(mockView.goTo).toHaveBeenCalledWith({ fraction: 0.42 });
  });

  it('getSectionFractions returns foliate view section fractions', async () => {
    const instance = await openTestInstance();

    expect(instance.rendition.getSectionFractions?.()).toEqual([0, 0.25, 0.5, 0.75]);
    expect(mockView.getSectionFractions).toHaveBeenCalled();
  });

  it('getSectionFractions returns an empty array when foliate view does not expose it', async () => {
    mockView.getSectionFractions = undefined as any;
    const instance = await openTestInstance();

    expect(instance.rendition.getSectionFractions?.()).toEqual([]);
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

describe('foliateEngine scrolled boundary helpers', () => {
  it('detects bottom and top boundaries within tolerance', () => {
    expect(isScrolledAtBottom({ viewSize: 1000, end: 998 })).toBe(true);
    expect(isScrolledAtBottom({ viewSize: 1000, end: 990 })).toBe(false);
    expect(isScrolledAtTop({ start: SCROLLED_BOUNDARY_TOLERANCE_PX })).toBe(true);
    expect(isScrolledAtTop({ start: SCROLLED_BOUNDARY_TOLERANCE_PX + 1 })).toBe(false);
  });

  it('prefetches when within the configured distance from a boundary', () => {
    expect(shouldPrefetchAdjacentSections({ viewSize: 2000, end: 1900, start: 50 })).toEqual({
      prefetchNext: true,
      prefetchPrev: true,
    });
    expect(
      shouldPrefetchAdjacentSections(
        { viewSize: 5000, end: 5000 - SCROLLED_PREFETCH_DISTANCE_PX - 10, start: 5000 },
      ),
    ).toEqual({
      prefetchNext: false,
      prefetchPrev: false,
    });
  });

  it('skips non-linear sections when resolving adjacent indices', () => {
    const sections = [
      { linear: 'yes' },
      { linear: 'no' },
      { linear: 'yes' },
    ];
    expect(findAdjacentLinearSectionIndex(sections, 0, 1)).toBe(2);
    expect(findAdjacentLinearSectionIndex(sections, 2, -1)).toBe(0);
    expect(findAdjacentLinearSectionIndex(sections, 0, -1)).toBeNull();
  });
});

describe('foliateEngine scrolled boundary bridge', () => {
  type ScrollListener = () => void;
  type WheelListener = (event: { deltaY: number; preventDefault: ReturnType<typeof vi.fn> }) => void;

  let scrollListener: ScrollListener | undefined;
  let wheelListener: WheelListener | undefined;
  let rendererState: {
    scrolled: boolean;
    start: number;
    end: number;
    viewSize: number;
    atStart: boolean;
    atEnd: boolean;
  };

  let mockRenderer: {
    scrolled: boolean;
    get start(): number;
    get end(): number;
    get viewSize(): number;
    atStart: boolean;
    atEnd: boolean;
    setAttribute: ReturnType<typeof vi.fn>;
    removeAttribute: ReturnType<typeof vi.fn>;
    getContents: ReturnType<typeof vi.fn>;
    setStyles: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    goTo: ReturnType<typeof vi.fn>;
  };

  let mockView: {
    renderer: typeof mockRenderer;
    book: { sections: Array<{ linear?: string; createDocument?: ReturnType<typeof vi.fn> }> };
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    lastLocation: { index: number } | null;
    open: ReturnType<typeof vi.fn>;
    init: ReturnType<typeof vi.fn>;
    goTo: ReturnType<typeof vi.fn>;
    prev: ReturnType<typeof vi.fn>;
    next: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    classList: { add: ReturnType<typeof vi.fn> };
    remove: ReturnType<typeof vi.fn>;
  };

  let originalCreateElement: typeof document.createElement;

  beforeEach(() => {
    scrollListener = undefined;
    wheelListener = undefined;
    rendererState = {
      scrolled: true,
      start: 0,
      end: 500,
      viewSize: 1000,
      atStart: false,
      atEnd: false,
    };

    mockRenderer = {
      get scrolled() {
        return rendererState.scrolled;
      },
      get start() {
        return rendererState.start;
      },
      get end() {
        return rendererState.end;
      },
      get viewSize() {
        return rendererState.viewSize;
      },
      get atStart() {
        return rendererState.atStart;
      },
      get atEnd() {
        return rendererState.atEnd;
      },
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      getContents: vi.fn(() => []),
      setStyles: vi.fn(),
      addEventListener: vi.fn((type: string, listener: ScrollListener | WheelListener, options?: AddEventListenerOptions) => {
        if (type === 'scroll') scrollListener = listener as ScrollListener;
        if (type === 'wheel') wheelListener = listener as WheelListener;
        if (type === 'wheel') expect(options).toEqual({ passive: false });
      }),
      removeEventListener: vi.fn(),
      goTo: vi.fn(),
    };

    const createDocument = vi.fn(async () => document.implementation.createHTMLDocument('prefetch'));
    mockView = {
      renderer: mockRenderer,
      book: {
        sections: [
          { linear: 'yes', createDocument },
          { linear: 'yes', createDocument: vi.fn(async () => document.implementation.createHTMLDocument('mid')) },
          { linear: 'yes', createDocument: vi.fn(async () => document.implementation.createHTMLDocument('tail')) },
        ],
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      lastLocation: { index: 1 },
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

  it('attaches scroll and wheel listeners when flow=scrolled is applied', async () => {
    const instance = await openTestInstance();

    instance.rendition.setLayout?.({ flow: 'scrolled' });

    expect(mockRenderer.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(mockRenderer.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
    expect(scrollListener).toBeTypeOf('function');
    expect(wheelListener).toBeTypeOf('function');
  });

  it('calls next at the bottom boundary and prev at the top without crossing book edges', async () => {
    const instance = await openTestInstance();
    instance.rendition.setLayout?.({ flow: 'scrolled' });

    rendererState.start = 400;
    rendererState.end = 900;
    rendererState.viewSize = 1000;
    scrollListener?.();

    rendererState.start = 998;
    rendererState.end = 1000;
    scrollListener?.();
    await Promise.resolve();
    expect(mockView.next).toHaveBeenCalledTimes(1);

    rendererState.atEnd = true;
    const preventDefault = vi.fn();
    wheelListener?.({ deltaY: 120, preventDefault });
    expect(mockView.next).toHaveBeenCalledTimes(1);
    expect(preventDefault).not.toHaveBeenCalled();

    rendererState.atEnd = false;
    rendererState.start = 200;
    rendererState.end = 700;
    scrollListener?.();
    await Promise.resolve();

    rendererState.start = 0;
    rendererState.end = 400;
    scrollListener?.();
    await Promise.resolve();
    expect(mockView.prev).toHaveBeenCalledTimes(1);

    rendererState.atStart = true;
    wheelListener?.({ deltaY: -80, preventDefault: vi.fn() });
    expect(mockView.prev).toHaveBeenCalledTimes(1);
  });

  it('prefetches adjacent sections when approaching a boundary', async () => {
    const instance = await openTestInstance();
    instance.rendition.setLayout?.({ flow: 'scrolled' });

    rendererState.start = 100;
    rendererState.end = 1900;
    rendererState.viewSize = 2000;
    scrollListener?.();

    expect(mockView.book.sections[0].createDocument).toHaveBeenCalledTimes(1);
    expect(mockView.book.sections[2].createDocument).toHaveBeenCalledTimes(1);

    scrollListener?.();
    expect(mockView.book.sections[0].createDocument).toHaveBeenCalledTimes(1);
    expect(mockView.book.sections[2].createDocument).toHaveBeenCalledTimes(1);
  });

  it('does not double-advance while a boundary navigation is in flight', async () => {
    let releaseNext: (() => void) | undefined;
    mockView.next.mockImplementation(() => new Promise<void>(resolve => {
      releaseNext = resolve;
    }));

    const instance = await openTestInstance();
    instance.rendition.setLayout?.({ flow: 'scrolled' });

    rendererState.start = 998;
    rendererState.end = 1000;
    scrollListener?.();
    wheelListener?.({ deltaY: 80, preventDefault: vi.fn() });
    expect(mockView.next).toHaveBeenCalledTimes(1);

    releaseNext?.();
    await Promise.resolve();
  });

  it('does not call next again when scroll stays at the bottom', async () => {
    const instance = await openTestInstance();
    instance.rendition.setLayout?.({ flow: 'scrolled' });

    rendererState.start = 998;
    rendererState.end = 1000;
    scrollListener?.();
    await Promise.resolve();
    expect(mockView.next).toHaveBeenCalledTimes(1);

    scrollListener?.();
    await Promise.resolve();
    expect(mockView.next).toHaveBeenCalledTimes(1);
  });
});
