import { create } from 'zustand';

/**
 * Transient reader UI state (issue #12).
 *
 * Sidebar / AI panel / search panel visibility. Not persisted — every mount
 * starts from the defaults below, matching the original `UIContext` behavior.
 */
type UIState = {
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  isAIPanelOpen: boolean;
  setAIPanelOpen: (open: boolean) => void;
  isSearchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
};

export const useUIStore = create<UIState>((set) => ({
  isSidebarOpen: true,
  setSidebarOpen: (open) => set({ isSidebarOpen: open }),
  isAIPanelOpen: false,
  setAIPanelOpen: (open) => set({ isAIPanelOpen: open }),
  isSearchOpen: false,
  setSearchOpen: (open) => set({ isSearchOpen: open }),
}));
