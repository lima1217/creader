import { Suspense, lazy, useEffect } from 'react';
import { useLibraryStore } from '../stores/libraryStore';
import './Reader.css';

let epubReaderPromise: ReturnType<typeof importEpubReader> | undefined;

function importEpubReader() {
    return import('./EPUBReader');
}

export function preloadEpubReader() {
    epubReaderPromise ??= importEpubReader();
    return epubReaderPromise;
}

const EPUBReader = lazy(async () => {
    const mod = await preloadEpubReader();
    return { default: mod.EPUBReader };
});

const ReaderLoading = () => (
    <div className="reader-empty">
        <div className="reader-empty-content">
            <div className="reader-empty-book" aria-hidden="true" />
            <h2>正在打开</h2>
            <p>准备 EPUB 内容。</p>
        </div>
    </div>
);

export function Reader() {
    const currentBook = useLibraryStore((s) => s.currentBook);

    useEffect(() => {
        if (currentBook) return;

        // Keep EPUB code off the startup critical path, then warm it before the
        // user is likely to open the first book. A click reuses the same promise.
        const w = window as typeof window & {
            requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
            cancelIdleCallback?: (handle: number) => void;
        };
        if (w.requestIdleCallback) {
            const handle = w.requestIdleCallback(() => void preloadEpubReader(), { timeout: 2500 });
            return () => w.cancelIdleCallback?.(handle);
        }

        const timer = window.setTimeout(() => void preloadEpubReader(), 1500);
        return () => window.clearTimeout(timer);
    }, [currentBook]);

    if (!currentBook) {
        return (
            <div className="reader-empty">
                <div className="reader-empty-content">
                    <div className="reader-empty-shelf" aria-hidden="true">
                        <div className="reader-empty-book reader-empty-book-primary" />
                        <div className="reader-empty-book reader-empty-book-secondary" />
                        <div className="reader-empty-book reader-empty-book-tertiary" />
                    </div>
                    <h2>书架还很安静</h2>
                    <p>从左侧书库导入 EPUB，开始阅读。</p>
                    <p className="reader-empty-formats">仅支持 EPUB</p>
                </div>
            </div>
        );
    }

    return <Suspense fallback={<ReaderLoading />}><EPUBReader /></Suspense>;
}
