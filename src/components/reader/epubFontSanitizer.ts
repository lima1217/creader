import type { Rendition } from 'epubjs';
import type { EpubBookLike, EpubSpineItem } from '../../services/reader/epubAdapter';
import { registerRenditionContentHook } from '../../services/reader/epubAdapter';

const fontFileExtRe = /\.(woff2?|woff|ttf|otf)(\?|#|$)/i;
const urlFuncRe = /url\(([^)]+)\)/gi;
const fontFaceBlockRe = /@font-face\s*{[\s\S]*?}/gi;

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function shouldRemoveFontFace(src: string): boolean {
  if (!src) return false;
  const matches = src.matchAll(urlFuncRe);
  for (const m of matches) {
    const raw = m[1] ?? '';
    const url = stripQuotes(raw);
    const lower = url.toLowerCase();
    if (!fontFileExtRe.test(lower)) continue;
    if (lower.startsWith('data:')) continue;
    if (lower.startsWith('blob:')) continue;
    return true;
  }
  return false;
}

function stripFontFaceBlocks(cssText: string): string {
  return cssText.replace(fontFaceBlockRe, (block) => (shouldRemoveFontFace(block) ? '' : block));
}

function sanitizeStyleElement(style: HTMLStyleElement): void {
  const cssText = style.textContent;
  if (!cssText || !cssText.includes('@font-face')) return;
  const sanitized = stripFontFaceBlocks(cssText);
  if (sanitized !== cssText) style.textContent = sanitized;
}

function resolveLinkHref(link: HTMLLinkElement, baseUrl?: string): string | null {
  const attr = link.getAttribute('href')?.trim();
  const candidate = link.href || attr;
  if (!candidate) return null;
  if (!baseUrl) return candidate;
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return candidate;
  }
}

async function sanitizeLinkElement(link: HTMLLinkElement, baseUrl?: string): Promise<void> {
  if (link.dataset.fontSanitized === 'true') return;
  link.dataset.fontSanitized = 'true';

  const href = resolveLinkHref(link, baseUrl);
  if (!href) return;

  const rel = (link.getAttribute('rel') ?? link.rel ?? '').toLowerCase();
  const shouldDisable = rel.includes('stylesheet');
  if (shouldDisable) link.disabled = true;

  try {
    const response = await fetch(href);
    if (!response.ok) {
      if (shouldDisable) link.disabled = false;
      return;
    }
    const cssText = await response.text();
    if (!cssText.includes('@font-face')) {
      if (shouldDisable) link.disabled = false;
      return;
    }
    const sanitized = stripFontFaceBlocks(cssText);
    if (sanitized === cssText) {
      if (shouldDisable) link.disabled = false;
      return;
    }
    const style = link.ownerDocument?.createElement('style');
    if (!style) {
      if (shouldDisable) link.disabled = false;
      return;
    }
    const media = link.getAttribute('media');
    if (media) style.setAttribute('media', media);
    style.textContent = sanitized;
    link.after(style);
    link.remove();
  } catch {
    if (shouldDisable) link.disabled = false;
  }
}

async function sanitizeFontFacesInDocument(
  doc: Document,
  baseUrl?: string,
  awaitLinks = false
): Promise<void> {
  const linkTasks: Promise<void>[] = [];
  const scheduleLink = (link: HTMLLinkElement) => {
    const task = sanitizeLinkElement(link, baseUrl);
    if (awaitLinks) {
      linkTasks.push(task);
    } else {
      void task;
    }
  };

  const styleSheets = Array.from(doc.styleSheets ?? []);
  for (const sheet of styleSheets) {
    try {
      const cssSheet = sheet as CSSStyleSheet;
      const rules = cssSheet.cssRules;
      for (let i = rules.length - 1; i >= 0; i--) {
        const rule = rules[i];
        if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
        const fontRule = rule as CSSFontFaceRule;
        const src = fontRule.style.getPropertyValue('src') ?? '';
        if (shouldRemoveFontFace(src)) cssSheet.deleteRule(i);
      }
    } catch {
      const ownerNode = (sheet as CSSStyleSheet).ownerNode;
      if (ownerNode instanceof HTMLStyleElement) {
        sanitizeStyleElement(ownerNode);
      } else if (ownerNode instanceof HTMLLinkElement) {
        scheduleLink(ownerNode);
      }
    }
  }

  const styleElements = Array.from(doc.querySelectorAll('style'));
  styleElements.forEach((style) => sanitizeStyleElement(style));

  const linkElements = Array.from(doc.querySelectorAll('link[rel~="stylesheet"]')) as HTMLLinkElement[];
  linkElements.forEach((link) => scheduleLink(link));

  if (awaitLinks && linkTasks.length > 0) {
    await Promise.all(linkTasks);
  }
}

export function setupEpubFontSanitizer(rendition: Rendition, book?: EpubBookLike | null): () => void {
  const observerByDoc = new Map<Document, MutationObserver>();

  const spineHook = (doc: Document, section?: EpubSpineItem) => {
    const baseUrl = section?.url || section?.href;
    return sanitizeFontFacesInDocument(doc, baseUrl, true);
  };

  const spineHooks = (book as EpubBookLike | undefined)?.spine?.hooks?.content;
  if (spineHooks?.register) {
    spineHooks.register(spineHook);
  }

  const prune = () => {
    for (const [doc, observer] of observerByDoc) {
      const frame = doc.defaultView?.frameElement;
      if (frame && !frame.isConnected) {
        observer.disconnect();
        observerByDoc.delete(doc);
      }
    }
  };

  registerRenditionContentHook(rendition, (contents) => {
    try {
      const doc = contents.document;
      if (!doc) return;
      prune();
      if (observerByDoc.has(doc)) return;

      const run = () => {
        try {
          void sanitizeFontFacesInDocument(doc, contents.window?.location?.href, false);
        } catch {
        }
      };

      run();
      setTimeout(run, 0);
      setTimeout(run, 60);

      const observer = new MutationObserver(() => run());
      const target = doc.head ?? doc.documentElement;
      observer.observe(target, { childList: true, subtree: true });
      observerByDoc.set(doc, observer);
    } catch {
    }
  });

  return () => {
    if (spineHooks?.deregister) {
      spineHooks.deregister(spineHook);
    }
    for (const [, observer] of observerByDoc) observer.disconnect();
    observerByDoc.clear();
  };
}
