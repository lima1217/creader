import { useEffect, useRef } from 'react';
import { isExternalFileDrag, firstEpubFile } from '../utils/epubFileDrop';
import { isTauriRuntime } from '../utils/tauri';

export function useEpubFileDropImport(
    importBookFile: (file: File) => Promise<void>,
    setIsDragging: (value: boolean) => void,
) {
    const importBookFileRef = useRef(importBookFile);
    const dragDepthRef = useRef(0);
    const externalDragRef = useRef(false);

    importBookFileRef.current = importBookFile;

    useEffect(() => {
        if (!isTauriRuntime()) return;

        const onDragEnter = (event: DragEvent) => {
            if (!isExternalFileDrag(event)) return;
            event.preventDefault();
            externalDragRef.current = true;
            dragDepthRef.current += 1;
            setIsDragging(true);
        };

        const onDragOver = (event: DragEvent) => {
            if (!isExternalFileDrag(event)) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        };

        const onDragLeave = () => {
            if (!externalDragRef.current) return;
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) {
                externalDragRef.current = false;
                setIsDragging(false);
            }
        };

        const onDrop = async (event: DragEvent) => {
            if (!externalDragRef.current) return;
            event.preventDefault();
            dragDepthRef.current = 0;
            externalDragRef.current = false;
            setIsDragging(false);
            const epub = firstEpubFile(event.dataTransfer?.files);
            if (epub) {
                await importBookFileRef.current(epub);
            }
        };

        window.addEventListener('dragenter', onDragEnter, true);
        window.addEventListener('dragover', onDragOver, true);
        window.addEventListener('dragleave', onDragLeave, true);
        window.addEventListener('drop', onDrop, true);

        return () => {
            window.removeEventListener('dragenter', onDragEnter, true);
            window.removeEventListener('dragover', onDragOver, true);
            window.removeEventListener('dragleave', onDragLeave, true);
            window.removeEventListener('drop', onDrop, true);
        };
    }, [setIsDragging]);
}
