import { useEffect } from 'react';
import { isEditableEventTarget } from '../utils/dom';

export function useKeyboardShortcuts(params: {
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  isAIPanelOpen: boolean;
  setAIPanelOpen: (open: boolean) => void;
}) {
  const {
    isSidebarOpen,
    setSidebarOpen,
    isAIPanelOpen,
    setAIPanelOpen,
  } = params;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableEventTarget(e.target)) return;

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const key = e.key.toLowerCase();
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
    isSidebarOpen,
    setAIPanelOpen,
    setSidebarOpen,
  ]);
}
