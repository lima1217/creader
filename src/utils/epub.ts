import ePub from 'epubjs';
import { readFile } from '@tauri-apps/plugin-fs';
import { createLogger } from './logger';

const logger = createLogger('EPUB');

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
    logger.debug('Starting metadata extraction for:', filePath);
    
    try {
        logger.debug('Reading file...');
        const fileData = await readFile(filePath);
        logger.debug('File read successfully, size:', fileData.length, 'bytes');

        // Create ArrayBuffer from the file data
        const arrayBuffer = fileData.buffer.slice(
            fileData.byteOffset,
            fileData.byteOffset + fileData.byteLength
        );
        logger.debug('ArrayBuffer created, size:', arrayBuffer.byteLength, 'bytes');

        const book = ePub(arrayBuffer);
        logger.debug('Book instance created, waiting for ready...');
        
        await book.ready;
        logger.debug('Book is ready');

        // Get metadata - epub.js stores metadata in the book object
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bookAny = book as any;
        
        // Try multiple metadata sources
        let metadata = bookAny.packaging?.metadata || {};
        
        logger.debug('Raw metadata:', metadata);
        logger.debug('Packaging:', bookAny.packaging);
        
        // Extract title - try multiple sources
        let title = metadata.title || 
                   bookAny.package?.metadata?.title ||
                   metadata.dc?.title ||
                   filePath.split('/').pop()?.replace('.epub', '') || 
                   'Unknown';
        
        // Extract author - try multiple sources
        let author = metadata.creator || 
                    metadata.author ||
                    bookAny.package?.metadata?.creator ||
                    metadata.dc?.creator ||
                    'Unknown';
        
        logger.debug('Extracted metadata - Title:', title, ', Author:', author);

        let coverBlob: Blob | undefined;
        
        // Try multiple methods to extract cover
        try {
            logger.debug('Attempting to extract cover...');
            
            // Method 1: Use coverUrl method
            if (typeof bookAny.coverUrl === 'function') {
                logger.debug('Trying coverUrl method...');
                const coverUrl = await bookAny.coverUrl();
                logger.debug('Cover URL:', coverUrl);
                
                if (coverUrl) {
                    const response = await fetch(coverUrl);
                    if (response.ok) {
                        coverBlob = await response.blob();
                        logger.debug('Cover extracted successfully via coverUrl, size:', coverBlob.size, 'bytes');
                    }
                }
            }
            
            // Method 2: Try to get cover from archive
            if (!coverBlob && bookAny.archive) {
                logger.debug('Trying archive method...');
                const coverPath = bookAny.cover || 
                                 metadata.cover || 
                                 bookAny.packaging?.manifest?.cover;
                
                logger.debug('Cover path:', coverPath);
                
                if (coverPath) {
                    try {
                        const coverData = await bookAny.archive.request(coverPath);
                        if (coverData) {
                            // Determine MIME type
                            const ext = coverPath.split('.').pop()?.toLowerCase();
                            const mimeType = ext === 'png' ? 'image/png' : 
                                           ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                                           ext === 'gif' ? 'image/gif' : 
                                           'image/jpeg';
                            
                            coverBlob = new Blob([coverData], { type: mimeType });
                            logger.debug('Cover extracted via archive, size:', coverBlob.size, 'bytes');
                        }
                    } catch (archiveError) {
                        logger.warn('Archive cover extraction failed:', archiveError);
                    }
                }
            }
            
            // Method 3: Search through resources
            if (!coverBlob && bookAny.resources) {
                logger.debug('Trying resources method...');
                const coverResource = bookAny.resources.get('cover') || 
                                     bookAny.resources.get('cover-image');
                
                if (coverResource && coverResource.url) {
                    logger.debug('Found cover resource:', coverResource.url);
                    const response = await fetch(coverResource.url);
                    if (response.ok) {
                        coverBlob = await response.blob();
                        logger.debug('Cover extracted via resources, size:', coverBlob.size, 'bytes');
                    }
                }
            }
            
            if (!coverBlob) {
                logger.warn('No cover found after trying all methods');
            }
        } catch (coverError) {
            logger.warn('Could not extract cover:', coverError);
            if (coverError instanceof Error) {
                logger.debug('Cover error details:', coverError.message, coverError.stack);
            }
        }

        // Cleanup
        book.destroy();
        logger.debug('Book instance destroyed');
        
        const result = { title, author, coverBlob };
        logger.debug('Final result:', { 
            title, 
            author, 
            hasCover: !!coverBlob,
            coverSize: coverBlob?.size 
        });

        return result;
    } catch (error) {
        logger.error('Failed to extract EPUB metadata:', error);
        if (error instanceof Error) logger.debug('Error details:', error.message, error.stack);
        
        // Return fallback values
        const fileName = filePath.split('/').pop() || 'Unknown';
        const fallback = {
            title: fileName.replace('.epub', ''),
            author: 'Unknown',
        };
        
        logger.debug('Returning fallback metadata:', fallback);
        return fallback;
    }
}
