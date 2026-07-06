import { describe, expect, it } from 'vitest';
import { uint8ArrayToBase64 } from './base64Bytes';

describe('uint8ArrayToBase64', () => {
  it('encodes bytes as standard base64', () => {
    const bytes = new Uint8Array([101, 112, 117, 98]);
    expect(uint8ArrayToBase64(bytes)).toBe('ZXB1Yg==');
  });

  it('handles payloads larger than one chunk', () => {
    const bytes = new Uint8Array(0x8001);
    bytes[0] = 65;
    bytes[0x8000] = 66;

    const encoded = uint8ArrayToBase64(bytes);
    expect(atob(encoded).charCodeAt(0)).toBe(65);
    expect(atob(encoded).charCodeAt(0x8000)).toBe(66);
  });
});
