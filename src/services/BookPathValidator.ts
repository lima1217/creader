/**
 * Book Path Validator Service
 * 
 * This service validates book file paths and attempts to fix them when files
 * are not found at the expected location. This is particularly important for
 * packaged applications where paths may differ from development.
 */

import type { Book, Library } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('BookPathValidator');

interface FindBookResult {
    found: boolean;
    path: string | null;
}

/**
 * Validate if a book file exists at the given path
 */
export async function validateBookPath(filePath: string): Promise<boolean> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<boolean>('validate_book_path', { filePath });
    } catch (error) {
        logger.warn('Failed to validate book path:', error);
        // In web environment, assume path is valid
        return true;
    }
}

/**
 * Try to find a book file in the app's books directory
 */
export async function findBookInLibrary(
    bookId: string,
    originalFilename?: string
): Promise<FindBookResult> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<FindBookResult>('find_book_in_library', {
            bookId,
            originalFilename: originalFilename || null,
        });
    } catch (error) {
        logger.warn('Failed to find book in library:', error);
        return { found: false, path: null };
    }
}

/**
 * Extract filename from a file path
 */
function getFilename(filePath: string): string {
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1] || '';
}

/**
 * Validate and fix book paths in the library
 * Returns an updated library with fixed paths and a list of books that couldn't be fixed
 */
export async function validateAndFixLibraryPaths(
    library: Library
): Promise<{
    updatedLibrary: Library;
    fixedBooks: string[];
    brokenBooks: string[];
}> {
    const fixedBooks: string[] = [];
    const brokenBooks: string[] = [];
    const updatedBooks: Book[] = [];

    let existsByIndex: boolean[] | null = null;
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        existsByIndex = await invoke<boolean[]>('validate_book_paths', {
            filePaths: library.books.map(b => b.filePath),
        });
    } catch (error) {
        logger.warn('Failed to batch validate book paths:', error);
        existsByIndex = null;
    }

    for (const book of library.books) {
        const idx = updatedBooks.length;
        const exists = existsByIndex ? existsByIndex[idx] === true : await validateBookPath(book.filePath);

        if (exists) {
            // Path is valid, keep as is
            updatedBooks.push(book);
        } else {
            // Try to find the book in the app's books directory
            const originalFilename = getFilename(book.filePath);
            const findResult = await findBookInLibrary(book.id, originalFilename);

            if (findResult.found && findResult.path) {
                // Found the book, update the path
                logger.debug(`Fixed path for book "${book.title}": ${findResult.path}`);
                updatedBooks.push({
                    ...book,
                    filePath: findResult.path,
                });
                fixedBooks.push(book.id);
            } else {
                // Could not find the book
                logger.warn(`Could not find book file for "${book.title}" (${book.id})`);
                updatedBooks.push(book);
                brokenBooks.push(book.id);
            }
        }
    }

    return {
        updatedLibrary: {
            ...library,
            books: updatedBooks,
            lastUpdated: fixedBooks.length > 0 ? Date.now() : library.lastUpdated,
        },
        fixedBooks,
        brokenBooks,
    };
}

/**
 * Get the app's books directory path
 */
export async function getBooksDirectory(): Promise<string | null> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<string>('get_books_directory');
    } catch (error) {
        logger.warn('Failed to get books directory:', error);
        return null;
    }
}
