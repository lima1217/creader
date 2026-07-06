import { invoke } from '@tauri-apps/api/core';

export interface FontFilePayload {
  bytesBase64: string;
  mimeType: string;
}

export async function readFontFileBase64(filePath: string): Promise<FontFilePayload> {
  return invoke<FontFilePayload>('read_font_file_base64', { filePath });
}

export async function readBundledFontBase64(resourceName: string): Promise<FontFilePayload> {
  return invoke<FontFilePayload>('read_bundled_font_base64', { resourceName });
}
