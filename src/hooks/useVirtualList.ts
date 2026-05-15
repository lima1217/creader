import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

interface UseVirtualListOptions {
    itemHeight: number;
    overscan?: number; // Number of items to render outside visible area
}

interface UseVirtualListResult<T> {
    virtualItems: Array<{ index: number; item: T; style: React.CSSProperties }>;
    totalHeight: number;
    containerRef: React.RefObject<HTMLDivElement | null>;
    visibleRange: { start: number; end: number };
}

export function useVirtualList<T>(
    items: T[],
    options: UseVirtualListOptions
): UseVirtualListResult<T> {
    const { itemHeight, overscan = 3 } = options;
    const containerRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [containerHeight, setContainerHeight] = useState(0);
    const rafIdRef = useRef<number | null>(null);
    const pendingScrollTopRef = useRef<number | null>(null);

    // Calculate visible range
    const visibleRange = useMemo(() => {
        const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
        const visibleCount = Math.ceil(containerHeight / itemHeight);
        const end = Math.min(items.length - 1, start + visibleCount + overscan * 2);
        return { start, end };
    }, [scrollTop, containerHeight, itemHeight, items.length, overscan]);

    // Create virtual items with positioning
    const virtualItems = useMemo(() => {
        const result: Array<{ index: number; item: T; style: React.CSSProperties }> = [];
        for (let i = visibleRange.start; i <= visibleRange.end && i < items.length; i++) {
            result.push({
                index: i,
                item: items[i],
                style: {
                    position: 'absolute',
                    top: i * itemHeight,
                    left: 0,
                    right: 0,
                    height: itemHeight,
                },
            });
        }
        return result;
    }, [items, visibleRange, itemHeight]);

    // Total height for scroll container
    const totalHeight = items.length * itemHeight;

    // Handle scroll events
    const handleScroll = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        pendingScrollTopRef.current = el.scrollTop;
        if (rafIdRef.current !== null) return;
        rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = null;
            const next = pendingScrollTopRef.current ?? 0;
            pendingScrollTopRef.current = null;
            setScrollTop(prev => (prev === next ? prev : next));
        });
    }, []);

    // Observe container size changes
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerHeight(entry.contentRect.height);
            }
        });

        resizeObserver.observe(container);
        setContainerHeight(container.clientHeight);

        container.addEventListener('scroll', handleScroll, { passive: true });

        return () => {
            resizeObserver.disconnect();
            container.removeEventListener('scroll', handleScroll);
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
        };
    }, [handleScroll]);

    return {
        virtualItems,
        totalHeight,
        containerRef,
        visibleRange,
    };
}
