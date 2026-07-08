import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyFoliateManagedStyles,
  composeFoliateThemeCss,
  toFoliateThemeCss,
  foliateEngineAdapter,
  isScrolledAtBottom,
  isScrolledAtTop,
  shouldPrefetchAdjacentSections,
  findAdjacentLinearSectionIndex,
  readPaginatorMetrics,
  SCROLLED_BOUNDARY_TOLERANCE_PX,
  SCROLLED_PREFETCH_DISTANCE_PX,
  BOUNDARY_ARM_THRESHOLD_PX,
  BOUNDARY_DELTA_CAP_PX,
  BOUNDARY_ARM_MIN_VISIBLE_MS,
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

  it('prepends @font-face rules before selector blocks via foliate setStyles tuple', () => {
    const css = composeFoliateThemeCss(
      { body: { color: '#111' } },
      '@font-face { font-family: "CReader Literata"; src: url("data:font/woff2;base64,AA") format("woff2"); }',
    );

    expect(Array.isArray(css)).toBe(true);
    expect(css[0]).toContain('@font-face');
    expect(css[1]).toContain('body{color:#111;}');
  });

  it('uses foliate renderer.setStyles so theme switches refresh the paginator background layer', () => {
    const setStyles = vi.fn();
    const css: [string, string] = ['@font-face { }', 'body{background:#FBF9F4 !important;}'];

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

  it('injects per-section reading CSS from resolved language on load', async () => {
    const { buildSectionReadingCss } = await import('./epubTypography');
    const { WESTERN_READING_FONT_STACK } = await import('../../components/reader/fontCatalog');
    await openTestInstance();
    const doc = document.implementation.createHTMLDocument('section');
    doc.documentElement.lang = 'en';
    doc.body.innerHTML =
      '<p>Hello world, this is an English paragraph with enough Latin letters for detection.</p>';

    loadHandler?.(new CustomEvent('load', { detail: { doc, index: 0 } }));
    await Promise.resolve();
    await Promise.resolve();

    const style = doc.getElementById('creader-foliate-typography') as HTMLStyleElement | null;
    expect(style?.textContent).toBe(buildSectionReadingCss('en', WESTERN_READING_FONT_STACK, 16));
  });

  it('infers Chinese reading CSS when lang metadata is missing', async () => {
    const { buildSectionReadingCss } = await import('./epubTypography');
    const { CJK_READING_FONT_STACK } = await import('../../components/reader/fontCatalog');
    await openTestInstance();
    const doc = document.implementation.createHTMLDocument('section');
    doc.body.innerHTML =
      '<p>无论是对热那亚商人对神圣罗马帝国皇帝选举的操控，或是美国南方种植园主对奴隶制的维护，商贸秩序的建立并非来源于。</p>';

    loadHandler?.(new CustomEvent('load', { detail: { doc, index: 0 } }));
    await Promise.resolve();
    await Promise.resolve();

    const style = doc.getElementById('creader-foliate-typography') as HTMLStyleElement | null;
    expect(style?.textContent).toBe(buildSectionReadingCss('zh', CJK_READING_FONT_STACK, 16));
    const p = doc.querySelector('p') as HTMLElement;
    expect(p.style.getPropertyPriority('font-family')).toBe('important');
    expect(p.style.getPropertyValue('font-family')).toContain('CReader LXGW WenKai');
    expect(p.style.getPropertyValue('font-size')).toBe('16px');
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

  it('returns null before foliate has mounted a section document', () => {
    const renderer = {
      scrolled: true,
      get start() {
        return 0;
      },
      get end() {
        return 0;
      },
      get viewSize(): number {
        throw new TypeError("Cannot read properties of null (reading 'element')");
      },
      atStart: false,
      atEnd: false,
    };
    expect(readPaginatorMetrics(renderer)).toBeNull();
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
        if (type === 'wheel') expect(options).toEqual({ passive: false, capture: true });
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

  it('attaches scroll and a single wheel listener when flow=scrolled is applied', async () => {
    const instance = await openTestInstance();

    instance.rendition.setLayout?.({ flow: 'scrolled' });

    expect(mockRenderer.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(mockRenderer.addEventListener).toHaveBeenCalledWith(
      'wheel',
      expect.any(Function),
      { passive: false, capture: true },
    );
    expect(mockView.addEventListener).not.toHaveBeenCalledWith(
      'wheel',
      expect.any(Function),
      expect.anything(),
    );
    expect(scrollListener).toBeTypeOf('function');
    expect(wheelListener).toBeTypeOf('function');
  });

  it('arms boundary only once per wheel dispatch (no triple capture listeners)', async () => {
    vi.useFakeTimers();
    const armEvents: Array<{ progress: number }> = [];
    const instance = await openTestInstance();
    instance.rendition.on('boundaryarm', (state: unknown) => {
      armEvents.push(state as { progress: number });
    });
    instance.rendition.setLayout?.({ flow: 'scrolled' });

    rendererState.start = 998;
    rendererState.end = 1000;
    rendererState.viewSize = 1000;

    const before = armEvents.length;
    wheelListener?.({ deltaY: 120, preventDefault: vi.fn() });
    expect(armEvents.length - before).toBe(1);

    vi.useRealTimers();
  });

  it('arms at the boundary and turns only after the hint has stayed visible past the min-visible window', async () => {
    // Min-visible gate uses Date.now(); freeze time so we can advance it deliberately.
    vi.useFakeTimers();
    const armEvents: Array<{ direction: string | null; progress: number; armed: boolean }> = [];
    const instance = await openTestInstance();
    instance.rendition.on('boundaryarm', (state: unknown) => {
      armEvents.push(state as { direction: string | null; progress: number; armed: boolean });
    });
    instance.rendition.setLayout?.({ flow: 'scrolled' });

    rendererState.start = 998;
    rendererState.end = 1000;
    rendererState.viewSize = 1000;

    // A single wheel tick arms (hint appears) but does NOT turn yet: threshold
    // not reached AND min-visible window not elapsed.
    const preventDefault = vi.fn();
    wheelListener?.({ deltaY: 120, preventDefault });
    expect(mockView.next).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();
    expect(armEvents[armEvents.length - 1]).toMatchObject({ direction: 'next', armed: true });
    expect((armEvents[armEvents.length - 1] as { progress: number }).progress).toBeGreaterThan(0);
    expect((armEvents[armEvents.length - 1] as { progress: number }).progress).toBeLessThan(1);

    // Cross the threshold but BEFORE the min-visible window elapses: still no turn.
    // Each tick is capped at BOUNDARY_DELTA_CAP_PX; accumulate past the threshold.
    const ticksToThreshold = Math.ceil(BOUNDARY_ARM_THRESHOLD_PX / BOUNDARY_DELTA_CAP_PX);
    for (let i = 1; i < ticksToThreshold; i++) {
      wheelListener?.({ deltaY: 120, preventDefault: vi.fn() });
    }
    expect(mockView.next).not.toHaveBeenCalled();
    // progress must be saturated at 1 by now, but the turn is gated on visibility time.
    expect((armEvents[armEvents.length - 1] as { progress: number }).progress).toBe(1);

    // Advance fake time past the min-visible window, then one more tick turns.
    vi.advanceTimersByTime(BOUNDARY_ARM_MIN_VISIBLE_MS + 10);
    wheelListener?.({ deltaY: 120, preventDefault: vi.fn() });
    await Promise.resolve();
    expect(mockView.next).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('does not turn at the book edge even with accumulated intent', async () => {
    vi.useFakeTimers();
    const instance = await openTestInstance();
    instance.rendition.setLayout?.({ flow: 'scrolled' });

    rendererState.start = 998;
    rendererState.end = 1000;
    rendererState.viewSize = 1000;
    rendererState.atEnd = true;

    const ticks = Math.ceil(BOUNDARY_ARM_THRESHOLD_PX / BOUNDARY_DELTA_CAP_PX) + 2;
    for (let i = 0; i < ticks; i++) wheelListener?.({ deltaY: 120, preventDefault: vi.fn() });
    vi.advanceTimersByTime(BOUNDARY_ARM_MIN_VISIBLE_MS + 10);
    for (let i = 0; i < ticks; i++) wheelListener?.({ deltaY: 120, preventDefault: vi.fn() });
    await Promise.resolve();
    expect(mockView.next).not.toHaveBeenCalled();

    // Top boundary symmetric.
    rendererState.atEnd = false;
    rendererState.atStart = true;
    rendererState.start = 0;
    rendererState.end = 400;
    for (let i = 0; i < ticks; i++) wheelListener?.({ deltaY: -120, preventDefault: vi.fn() });
    vi.advanceTimersByTime(BOUNDARY_ARM_MIN_VISIBLE_MS + 10);
    for (let i = 0; i < ticks; i++) wheelListener?.({ deltaY: -120, preventDefault: vi.fn() });
    await Promise.resolve();
    expect(mockView.prev).not.toHaveBeenCalled();

    vi.useRealTimers();
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
    vi.useFakeTimers();
    let releaseNext: (() => void) | undefined;
    mockView.next.mockImplementation(() => new Promise<void>(resolve => {
      releaseNext = resolve;
    }));

    const instance = await openTestInstance();
    instance.rendition.setLayout?.({ flow: 'scrolled' });

    rendererState.start = 998;
    rendererState.end = 1000;
    rendererState.viewSize = 1000;

    // Accumulate past threshold, advance past min-visible, then turn.
    const ticks = Math.ceil(BOUNDARY_ARM_THRESHOLD_PX / BOUNDARY_DELTA_CAP_PX);
    for (let i = 0; i < ticks; i++) wheelListener?.({ deltaY: 120, preventDefault: vi.fn() });
    vi.advanceTimersByTime(BOUNDARY_ARM_MIN_VISIBLE_MS + 10);
    wheelListener?.({ deltaY: 120, preventDefault: vi.fn() });
    expect(mockView.next).toHaveBeenCalledTimes(1);

    // While the turn is in flight, further arming is ignored.
    for (let i = 0; i < ticks; i++) wheelListener?.({ deltaY: 120, preventDefault: vi.fn() });
    vi.advanceTimersByTime(BOUNDARY_ARM_MIN_VISIBLE_MS + 10);
    wheelListener?.({ deltaY: 120, preventDefault: vi.fn() });
    expect(mockView.next).toHaveBeenCalledTimes(1);

    releaseNext?.();
    await Promise.resolve();
    vi.useRealTimers();
  });

  it('decays the arm and emits a disarmed event after scrolling stops', async () => {
    vi.useFakeTimers();
    const armEvents: Array<{ armed: boolean }> = [];
    const instance = await openTestInstance();
    instance.rendition.on('boundaryarm', (state: unknown) => {
      armEvents.push(state as { armed: boolean });
    });
    instance.rendition.setLayout?.({ flow: 'scrolled' });

    rendererState.start = 998;
    rendererState.end = 1000;
    rendererState.viewSize = 1000;
    wheelListener?.({ deltaY: 120, preventDefault: vi.fn() });
    expect(armEvents[armEvents.length - 1]).toMatchObject({ armed: true });

    vi.advanceTimersByTime(700);
    expect(armEvents[armEvents.length - 1]).toMatchObject({ armed: false });

    vi.useRealTimers();
  });
});
