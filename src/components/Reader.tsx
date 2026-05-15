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
            <h2>Opening book</h2>
            <p>Preparing the EPUB.</p>
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
                    <h2>Your EPUB shelf is quiet</h2>
                    <p>Import an EPUB from the library sidebar to begin reading.</p>
                    <p className="reader-empty-formats">EPUB only</p>
                </div>
            </div>
        );
    }

    return <Suspense fallback={<ReaderLoading />}><EPUBReader /></Suspense>;
}
