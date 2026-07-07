import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../types';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import { DEFAULT_READING_LAYOUT } from '../../services/reader/readingEngine';
import { useEpubSettingsSync } from './useEpubSettingsSync';

const themeMock = vi.hoisted(() => ({ applyEpubTheme: vi.fn() }));
vi.mock('./epubTheme', () => ({
  applyEpubTheme: themeMock.applyEpubTheme,
}));
vi.mock('./useFontFaceCss', () => ({
  useFontFaceCss: () => '',
}));
vi.mock('./fontCatalog', () => ({
  resolveFontStack: () => (
    '"CReader Roboto", "CReader LXGW WenKai", -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'
  ),
}));

const baseSettings: Settings = {
  theme: 'light',
  fontSize: 16,
  lineHeight: 1.6,
  readingMemoryAutoIngest: false,
  aiTextSize: 14,
  aiContextWindow: 20,
  aiToolRounds: 8,
  aiAutoSummarize: false,
  aiThinkingEnabled: false,
};

interface MockRendition {
  setLayout: ReturnType<typeof vi.fn>;
  display: ReturnType<typeof vi.fn>;
  themes: { default: ReturnType<typeof vi.fn> };
}

function createMockRendition(): MockRendition {
  return {
    setLayout: vi.fn(),
    display: vi.fn(),
    themes: { default: vi.fn() },
  };
}

function Harness({
  rendition,
  settings,
}: {
  rendition: MockRendition;
  settings: Settings;
}) {
  const renditionRef = useRef<ReaderRendition | null>(
    rendition as unknown as ReaderRendition,
  );
  // Hold the latest settings in state so we can flip them and trigger the effect.
  const [, setTick] = useState(0);
  useEpubSettingsSync(renditionRef, settings);
  // Re-render on demand from the test.
  (Harness as unknown as { _rerender?: () => void })._rerender = () => setTick((t) => t + 1);
  return null;
}

function setup(settings: Settings) {
  const rendition = createMockRendition();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(<Harness rendition={rendition} settings={settings} />));
  return { rendition, root, container };
}

describe('useEpubSettingsSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies the fixed layout and theme to the current rendition', () => {
    const { rendition } = setup(baseSettings);

    expect(rendition.setLayout).toHaveBeenCalledWith(DEFAULT_READING_LAYOUT);
    expect(themeMock.applyEpubTheme).toHaveBeenCalledWith(
      rendition as unknown as ReaderRendition,
      expect.objectContaining({
        theme: 'light',
        fontStack: '"CReader Roboto", "CReader LXGW WenKai", -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
        fontSize: 16,
      }),
    );
  });

  it('does not re-display when settings change (regression guard for #88)', () => {
    const { rendition, root } = setup(baseSettings);

    rendition.setLayout.mockClear();
    rendition.display.mockClear();
    themeMock.applyEpubTheme.mockClear();

    const next: Settings = { ...baseSettings, fontSize: 20, theme: 'dark' };
    flushSync(() => root.render(<Harness rendition={rendition} settings={next} />));

    // Layout + theme re-applied...
    expect(rendition.setLayout).toHaveBeenCalledWith(DEFAULT_READING_LAYOUT);
    expect(themeMock.applyEpubTheme).toHaveBeenCalled();
    // ...but position is left to the engine's anchor — never re-displayed.
    expect(rendition.display).not.toHaveBeenCalled();
  });

  it('is a no-op until a rendition exists', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    function EmptyHarness() {
      const renditionRef = useRef<ReaderRendition | null>(null);
      useEpubSettingsSync(renditionRef, baseSettings);
      return null;
    }

    expect(() => flushSync(() => root.render(<EmptyHarness />))).not.toThrow();

    expect(themeMock.applyEpubTheme).not.toHaveBeenCalled();

    flushSync(() => root.unmount());
    container.remove();
  });
});
