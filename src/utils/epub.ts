import ePub from 'epubjs';
import { readFile } from '@tauri-apps/plugin-fs';

export interface EpubMetadata {
    title: string;
    author: string;
    coverBlob?: Blob;
}

/**
 * Extract metadata from an EPUB file
 * @param filePath - The absolute path to the EPUB file
 * @returns Promise<EpubMetadata>
 */
export async function extractEpubMetadata(filePath: string): Promise<EpubMetadata> {
    try {
        // Read the file as binary
        const fileData = await readFile(filePath);

        // Create a Blob from the file data
        const blob = new Blob([fileData], { type: 'application/epub+zip' });
        const arrayBuffer = await blob.arrayBuffer();

        // Create epub.js book instance - cast to any to handle ArrayBuffer
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const book = ePub(arrayBuffer as any);
        await book.ready;

        // Get metadata - epub.js stores metadata in the book object
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bookAny = book as any;
        const metadata = bookAny.packaging?.metadata || {};
        const title = metadata.title || filePath.split('/').pop()?.replace('.epub', '') || 'Unknown';
        const author = metadata.creator || 'Unknown';

        let coverBlob: Blob | undefined;
        try {
            // epub.js coverUrl method
            if (typeof bookAny.coverUrl === 'function') {
                const coverUrl = await bookAny.coverUrl();
                if (coverUrl) {
                    const response = await fetch(coverUrl);
                    coverBlob = await response.blob();
                }
            }
        } catch (e) {
            console.warn('Could not extract cover:', e);
        }

        // Cleanup
        book.destroy();

        return { title, author, coverBlob };
    } catch (error) {
        console.error('Failed to extract EPUB metadata:', error);
        // Return fallback values
        const fileName = filePath.split('/').pop() || 'Unknown';
        return {
            title: fileName.replace('.epub', ''),
            author: 'Unknown',
        };
    }
}
