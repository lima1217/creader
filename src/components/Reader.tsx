import { Suspense, lazy } from 'react';
import { useLibrary } from '../stores/AppContext';
import './Reader.css';

const EPUBReader = lazy(async () => {
    const mod = await import('./EPUBReader');
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
    const { currentBook } = useLibrary();

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
