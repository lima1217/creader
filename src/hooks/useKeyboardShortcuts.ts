import { useEffect } from 'react';

export function useKeyboardShortcuts(params: {
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  isSearchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  isAIPanelOpen: boolean;
  setAIPanelOpen: (open: boolean) => void;
}) {
  const {
    isSidebarOpen,
    setSidebarOpen,
    isSearchOpen,
    setSearchOpen,
    isAIPanelOpen,
    setAIPanelOpen,
  } = params;

  useEffect(() => {
    const isEditable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (target.isContentEditable) return true;
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const key = e.key.toLowerCase();
      if (key === 'f') {
        e.preventDefault();
        setSearchOpen(!isSearchOpen);
        return;
      }
      if (key === 'b') {
        e.preventDefault();
        setSidebarOpen(!isSidebarOpen);
        return;
      }
      if (key === 'a' && e.shiftKey) {
        e.preventDefault();
        setAIPanelOpen(!isAIPanelOpen);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isAIPanelOpen,
    isSearchOpen,
    isSidebarOpen,
    setAIPanelOpen,
    setSearchOpen,
    setSidebarOpen,
  ]);
}

