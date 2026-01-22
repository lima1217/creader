import { useState, useEffect, useRef, useCallback } from 'react';

interface UseLazyLoadOptions {
    rootMargin?: string;
    threshold?: number;
    once?: boolean; // Only trigger once then disconnect
}

interface UseLazyLoadResult {
    ref: React.RefObject<HTMLElement | null>;
    isVisible: boolean;
    hasBeenVisible: boolean; // Track if element was ever visible
}

export function useLazyLoad(options: UseLazyLoadOptions = {}): UseLazyLoadResult {
    const { rootMargin = '50px', threshold = 0, once = true } = options;
    const ref = useRef<HTMLElement | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [hasBeenVisible, setHasBeenVisible] = useState(false);

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        // If already visible and only need to trigger once, skip observer
        if (once && hasBeenVisible) return;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setIsVisible(true);
                        setHasBeenVisible(true);
                        if (once) {
                            observer.disconnect();
                        }
                    } else {
                        setIsVisible(false);
                    }
                });
            },
            { rootMargin, threshold }
        );

        observer.observe(element);

        return () => {
            observer.disconnect();
        };
    }, [rootMargin, threshold, once, hasBeenVisible]);

    return { ref, isVisible, hasBeenVisible };
}

// Hook to batch load covers for visible items
interface UseBatchCoverLoaderOptions {
    loadCover: (bookId: string) => Promise<string | null>;
    batchSize?: number;
    delay?: number;
}

export function useBatchCoverLoader(options: UseBatchCoverLoaderOptions) {
    const { loadCover, batchSize = 5, delay = 100 } = options;
    const [loadedCovers, setLoadedCovers] = useState<Record<string, string>>({});
    const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
    const queueRef = useRef<string[]>([]);
    const processingRef = useRef(false);

    const processQueue = useCallback(async () => {
        if (processingRef.current || queueRef.current.length === 0) return;
        processingRef.current = true;

        const batch = queueRef.current.splice(0, batchSize);
        const results: Record<string, string> = {};

        await Promise.all(
            batch.map(async (id) => {
                try {
                    const url = await loadCover(id);
                    if (url) {
                        results[id] = url;
                    }
                } catch (e) {
                    console.warn('Failed to load cover:', id, e);
                }
            })
        );

        setLoadedCovers((prev) => ({ ...prev, ...results }));
        setLoadingIds((prev) => {
            const next = new Set(prev);
            batch.forEach((id) => next.delete(id));
            return next;
        });

        processingRef.current = false;

        // Continue processing if more items in queue
        if (queueRef.current.length > 0) {
            setTimeout(processQueue, delay);
        }
    }, [loadCover, batchSize, delay]);

    const requestCover = useCallback(
        (bookId: string) => {
            if (loadedCovers[bookId] || loadingIds.has(bookId) || queueRef.current.includes(bookId)) {
                return;
            }
            queueRef.current.push(bookId);
            setLoadingIds((prev) => new Set(prev).add(bookId));
            processQueue();
        },
        [loadedCovers, loadingIds, processQueue]
    );

    return {
        loadedCovers,
        loadingIds,
        requestCover,
        isLoading: (bookId: string) => loadingIds.has(bookId),
        getCover: (bookId: string) => loadedCovers[bookId] || null,
    };
}
