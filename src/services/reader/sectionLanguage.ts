import { isCjkLang } from './epubTypography';

type ScriptBucket = 'han' | 'hiragana' | 'katakana' | 'hangul' | 'latin';

const SAMPLE_CHAR_LIMIT = 4000;
const MIN_LETTER_COUNT = 20;

function classifyCharScript(char: string): ScriptBucket | 'other' {
  const code = char.codePointAt(0);
  if (code == null) return 'other';
  if (code >= 0x3040 && code <= 0x309f) return 'hiragana';
  if (code >= 0x30a0 && code <= 0x30ff) return 'katakana';
  if (code >= 0xac00 && code <= 0xd7af) return 'hangul';
  if (
    (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0xf900 && code <= 0xfaff)
  ) {
    return 'han';
  }
  if (/[a-zA-Z]/.test(char)) return 'latin';
  return 'other';
}

/** Compact body text sample for script detection (whitespace stripped). */
export function sampleDocumentText(doc: Document, maxChars = SAMPLE_CHAR_LIMIT): string {
  return (doc.body?.textContent ?? '').replace(/\s+/g, '').slice(0, maxChars);
}

/**
 * Guess a BCP-47 primary tag from visible letters. Returns null when the
 * sample is too small to be confident.
 */
export function detectDominantLangTag(text: string): string | null {
  const counts: Record<ScriptBucket, number> = {
    han: 0,
    hiragana: 0,
    katakana: 0,
    hangul: 0,
    latin: 0,
  };

  for (const char of text) {
    const script = classifyCharScript(char);
    if (script !== 'other') counts[script]++;
  }

  const cjkLetters = counts.han + counts.hiragana + counts.katakana + counts.hangul;
  const letterCount = cjkLetters + counts.latin;
  if (letterCount < MIN_LETTER_COUNT) return null;

  if (counts.hangul > counts.han && counts.hangul >= counts.latin) return 'ko';
  if (counts.hiragana + counts.katakana >= Math.max(counts.latin, 8)) return 'ja';
  if (counts.han >= counts.latin) return 'zh';
  if (counts.latin > 0) return 'en';
  return null;
}

function langFamiliesDisagree(declared: string, detected: string): boolean {
  return isCjkLang(declared) !== isCjkLang(detected);
}

/**
 * Effective section language for typography and font selection.
 *
 * 1. Trust declared `<html lang>` when present and not contradicted by content.
 * 2. Otherwise infer from a short body sample (fixes missing/wrong EPUB metadata).
 * 3. Fall back to OPF `dc:language` when the section sample is too small.
 */
export function resolveSectionLanguage(doc: Document, bookLanguageHint = ''): string {
  const declared = doc.documentElement.lang?.trim() ?? '';
  const detected = detectDominantLangTag(sampleDocumentText(doc));

  if (declared && declared.toLowerCase() !== 'und') {
    if (!detected || !langFamiliesDisagree(declared, detected)) return declared;
  }

  if (detected) return detected;
  if (declared) return declared;
  return bookLanguageHint.trim();
}
