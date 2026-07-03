import { beforeEach, describe, expect, it } from 'vitest';
import { useUIStore } from './uiStore';

/**
 * Transient UI store (issue #12): sidebar / AI panel / search panel visibility.
 * Not persisted; each reset returns the defaults.
 */
describe('uiStore', () => {
  beforeEach(() => {
    useUIStore.setState({ isSidebarOpen: true, isAIPanelOpen: false, isSearchOpen: false });
  });

  it('starts with sidebar open and panels closed', () => {
    const s = useUIStore.getState();
    expect(s.isSidebarOpen).toBe(true);
    expect(s.isAIPanelOpen).toBe(false);
    expect(s.isSearchOpen).toBe(false);
  });

  it('toggles each panel independently via its setter', () => {
    useUIStore.getState().setAIPanelOpen(true);
    useUIStore.getState().setSearchOpen(true);
    useUIStore.getState().setSidebarOpen(false);

    const s = useUIStore.getState();
    expect(s.isAIPanelOpen).toBe(true);
    expect(s.isSearchOpen).toBe(true);
    expect(s.isSidebarOpen).toBe(false);
  });
});
