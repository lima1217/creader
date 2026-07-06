export interface FontFaceRule {
  fontFamily: string;
  src: string;
  fontWeight?: string;
  fontStyle?: string;
}

export function buildFontFaceCss(rules: readonly FontFaceRule[]): string {
  return rules
    .map((rule) => {
      const parts = [
        `font-family: ${quoteFontFamily(rule.fontFamily)}`,
        `src: url("${rule.src}") format("${formatForSrc(rule.src)}")`,
      ];
      if (rule.fontWeight) parts.push(`font-weight: ${rule.fontWeight}`);
      if (rule.fontStyle) parts.push(`font-style: ${rule.fontStyle}`);
      return `@font-face { ${parts.join('; ')}; }`;
    })
    .join('\n');
}

export function toFontDataUrl(bytesBase64: string, mimeType: string): string {
  return `data:${mimeType};base64,${bytesBase64}`;
}

function quoteFontFamily(name: string): string {
  return name.includes(' ') ? `"${name}"` : name;
}

function formatForSrc(src: string): string {
  if (src.includes('font/woff2') || src.endsWith('.woff2')) return 'woff2';
  if (src.includes('font/woff') || src.endsWith('.woff')) return 'woff';
  if (src.includes('font/otf') || src.endsWith('.otf')) return 'opentype';
  return 'truetype';
}
