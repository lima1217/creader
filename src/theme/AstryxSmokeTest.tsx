import { Button } from '@astryxdesign/core/Button';

/**
 * TEMPORARY smoke test for the Astryx wiring (slice 1).
 *
 * Renders a single Astryx `Button` in paper colors to confirm the reset +
 * base CSS + `<Theme>` provider + paper theme tokens all reach an Astryx
 * component before the real component migrations land in slices 3–5.
 *
 * Visually hidden (not display:none, so it still resolves tokens) and removed
 * from the tab order. Removed entirely once settings is migrated onto Astryx.
 */
export function AstryxSmokeTest() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
        pointerEvents: 'none',
      }}
    >
      <Button label="Astryx smoke test" onClick={() => {}} />
    </div>
  );
}
