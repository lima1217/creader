declare module 'epubjs' {
    export interface Book {
        ready: Promise<void>;
        navigation: Navigation;
        renderTo(element: HTMLElement, options?: RenditionOptions): Rendition;
        destroy(): void;
    }

    export interface Navigation {
        toc: TocItem[];
    }

    export interface TocItem {
        id: string;
        href: string;
        label: string;
        subitems?: TocItem[];
    }

    export interface RenditionOptions {
        width?: string | number;
        height?: string | number;
        spread?: 'none' | 'always' | 'auto';
        flow?: 'paginated' | 'scrolled' | 'scrolled-doc';
        manager?: 'default' | 'continuous';
        allowScriptedContent?: boolean;
        sandbox?: string[];
    }

    export interface Rendition {
        display(target?: string): Promise<void>;
        prev(): Promise<void>;
        next(): Promise<void>;
        themes: Themes;
        on(event: string, callback: (...args: unknown[]) => void): void;
        off(event: string, callback: (...args: unknown[]) => void): void;
    }

    export interface Themes {
        default(styles: Record<string, Record<string, string>>): void;
        register(name: string, styles: Record<string, Record<string, string>>): void;
        select(name: string): void;
    }

    export interface Location {
        start: {
            cfi: string;
            displayed: {
                page: number;
                total: number;
            };
        };
        end: {
            cfi: string;
            percentage: number;
        };
    }

    export default function ePub(
        urlOrData: string | ArrayBuffer | Uint8Array,
        options?: Record<string, unknown>
    ): Book;
}
