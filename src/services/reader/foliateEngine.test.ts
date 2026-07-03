import { describe, expect, it, vi } from 'vitest';
import { applyFoliateManagedStyles, toFoliateThemeCss } from './foliateEngine';

describe('foliateEngine theme bridge', () => {
  it('serializes theme rules as foliate-managed CSS', () => {
    const css = toFoliateThemeCss({
      body: {
        color: '#111 !important',
        background: '#fff !important',
      },
      a: {
        color: '#264466 !important',
      },
    });

    expect(css).toBe('body{color:#111 !important;background:#fff !important;}\na{color:#264466 !important;}');
  });

  it('uses foliate renderer.setStyles so theme switches refresh the paginator background layer', () => {
    const setStyles = vi.fn();
    const css = 'body{background:#FBF7EF !important;}';

    const applied = applyFoliateManagedStyles({ setStyles }, css);

    expect(applied).toBe(true);
    expect(setStyles).toHaveBeenCalledWith(css);
  });

  it('reports unmanaged renderers so callers can fall back to direct document style injection', () => {
    expect(applyFoliateManagedStyles(undefined, 'body{}')).toBe(false);
    expect(applyFoliateManagedStyles({}, 'body{}')).toBe(false);
  });
});
