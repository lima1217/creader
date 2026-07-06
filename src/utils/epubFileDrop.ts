export function isExternalFileDrag(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function firstEpubFile(files: FileList | null | undefined): File | undefined {
    if (!files?.length) return undefined;
    return Array.from(files).find((file) => file.name.toLowerCase().endsWith('.epub'));
}
