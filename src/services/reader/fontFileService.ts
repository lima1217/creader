import { invoke } from '@tauri-apps/api/core';

export interface FontFilePayload {
  bytesBase64: string;
  mimeType: string;
}

export async function readBundledFontBase64(resourceName: string): Promise<FontFilePayload> {
  return invoke<FontFilePayload>('read_bundled_font_base64', { resourceName });
}
