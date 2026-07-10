import { useEffect, useRef } from 'react';
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

  const isSidebarOpenRef = useRef(isSidebarOpen);
  const isAIPanelOpenRef = useRef(isAIPanelOpen);
  const setSidebarOpenRef = useRef(setSidebarOpen);
  const setAIPanelOpenRef = useRef(setAIPanelOpen);

  isSidebarOpenRef.current = isSidebarOpen;
  isAIPanelOpenRef.current = isAIPanelOpen;
  setSidebarOpenRef.current = setSidebarOpen;
  setAIPanelOpenRef.current = setAIPanelOpen;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableEventTarget(e.target)) return;

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const key = e.key.toLowerCase();
      if (key === 'b') {
        e.preventDefault();
        setSidebarOpenRef.current(!isSidebarOpenRef.current);
        return;
      }
      if (key === 'a' && e.shiftKey) {
        e.preventDefault();
        setAIPanelOpenRef.current(!isAIPanelOpenRef.current);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
