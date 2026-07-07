import { describe, expect, it } from 'vitest';
import {
  ensureSectionFontFaces,
  forceReadingTypography,
  stripPublisherTypographyOverrides,
} from './sectionTypographyOverrides';

function docWith(html: string): Document {
  const doc = document.implementation.createHTMLDocument('section');
  doc.body.innerHTML = html;
  return doc;
}

const CJK_STACK = '"CReader LXGW WenKai", serif';

describe('stripPublisherTypographyOverrides', () => {
  it('removes inline font and spacing overrides', () => {
    const doc = docWith('<p style="font-family: FZShuSong; font-size: 14px; letter-spacing: 2px; color: red;">正文</p>');
    stripPublisherTypographyOverrides(doc);
    const p = doc.querySelector('p') as HTMLElement;
    expect(p.style.fontFamily).toBe('');
    expect(p.style.fontSize).toBe('');
    expect(p.style.letterSpacing).toBe('');
    expect(p.style.color).toBe('red');
  });

  it('clears legacy font element attributes', () => {
    const doc = docWith('<font face="SimSun" size="4">正文</font>');
    stripPublisherTypographyOverrides(doc);
    const font = doc.querySelector('font')!;
    expect(font.getAttribute('face')).toBeNull();
    expect(font.getAttribute('size')).toBeNull();
  });
});

describe('forceReadingTypography', () => {
  it('sets inline important font-family and font-size on text nodes', () => {
    const doc = docWith('<p><span class="publisher">正文</span></p>');
    forceReadingTypography(doc, '"CReader LXGW WenKai", serif', 20);
    const span = doc.querySelector('span') as HTMLElement;
    expect(span.style.getPropertyValue('font-family')).toContain('CReader LXGW WenKai');
    expect(span.style.getPropertyPriority('font-family')).toBe('important');
    expect(span.style.getPropertyValue('font-size')).toBe('20px');
    expect(span.style.getPropertyPriority('font-size')).toBe('important');
  });

  it('keeps heading descendants on the publisher scale', () => {
    const doc = docWith('<h1><span>标题</span></h1><p>正文</p>');
    forceReadingTypography(doc, '"CReader LXGW WenKai", serif', 18);
    const headingSpan = doc.querySelector('h1 span') as HTMLElement;
    const paragraph = doc.querySelector('p') as HTMLElement;
    expect(headingSpan.style.getPropertyValue('font-size')).toBe('');
    expect(paragraph.style.getPropertyValue('font-size')).toBe('18px');
  });

  it('forces CJK line-height, indent, and spacing as inline !important on paragraphs', () => {
    const doc = docWith('<p>正文段落</p>');
    forceReadingTypography(doc, CJK_STACK, 20, { lang: 'zh-CN' });
    const p = doc.querySelector('p') as HTMLElement;
    expect(p.style.getPropertyValue('line-height')).toBe('1.6');
    expect(p.style.getPropertyPriority('line-height')).toBe('important');
    expect(p.style.getPropertyValue('text-indent')).toBe('2em');
    expect(p.style.getPropertyPriority('text-indent')).toBe('important');
    expect(p.style.getPropertyValue('text-align')).toBe('left');
    expect(p.style.getPropertyPriority('text-align')).toBe('important');
    expect(p.style.getPropertyValue('letter-spacing')).toBe('normal');
    expect(p.style.getPropertyPriority('letter-spacing')).toBe('important');
  });

  it('forces western justify / no-indent typography for non-CJK sections', () => {
    const doc = docWith('<p>English paragraph.</p>');
    forceReadingTypography(doc, CJK_STACK, 18, { lang: 'en' });
    const p = doc.querySelector('p') as HTMLElement;
    expect(p.style.getPropertyValue('text-align')).toBe('justify');
    expect(p.style.getPropertyValue('line-height')).toBe('1.4');
    // Western paragraphs have no first-line indent (token "0"); browsers keep
    // a bare 0 inline, so check the resolved length is zero, not the unit form.
    expect(p.style.getPropertyValue('text-indent')).toBe('0');
  });

  it('defaults to CJK values when lang is omitted (matches buildSectionTypographyCss CJK branch)', () => {
    const doc = docWith('<p>正文</p>');
    forceReadingTypography(doc, CJK_STACK, 18);
    const p = doc.querySelector('p') as HTMLElement;
    expect(p.style.getPropertyValue('line-height')).toBe('1.6');
    expect(p.style.getPropertyValue('text-indent')).toBe('2em');
  });
});

describe('forceReadingTypography vs publisher class !important rules', () => {
  // Regression for the cascade bug: publisher CSS like `.calibre2 p { line-height: 1.2 !important }`
  // (specificity 0,1,1) used to beat CReader's `p { line-height: 1.6 !important }` (0,0,1) inside
  // the shared author-!important cascade layer, so Chinese books kept the publisher's tight
  // line-height, letter-spacing, and zero indent. Inline !important on each node wins regardless
  // of publisher class specificity, so this test must hold against a real CSS cascade.
  //
  // The vitest jsdom environment supplies a real `document`/`window` whose
  // `getComputedStyle` resolves the cascade, so we build the publisher-styled
  // document via `document.write` instead of importing JSDOM directly.
  function docWithPublisherCss(bodyHtml: string, publisherCss: string): Document {
    document.open();
    document.write(`<!doctype html><html><head><style>${publisherCss}</style></head><body>${bodyHtml}</body></html>`);
    document.close();
    return document;
  }

  it('CReader CJK typography wins over publisher class !important', () => {
    const publisherCss = [
      '.calibre2 p { line-height: 1.2 !important; letter-spacing: -0.5px !important; text-align: justify !important; }',
      'p.calibre3 { margin-top: 0 !important; text-indent: 0 !important; }',
    ].join('\n');
    const doc = docWithPublisherCss(
      '<div class="calibre2"><p class="calibre3">这是一段中文正文，用来验证排版级联。</p></div>',
      publisherCss,
    );
    forceReadingTypography(doc, CJK_STACK, 20, { lang: 'zh-CN' });

    const p = doc.querySelector('p')!;
    const cs = window.getComputedStyle(p);
    expect(cs.lineHeight).toBe('1.6');
    expect(cs.letterSpacing).toBe('normal');
    expect(cs.textAlign).toBe('left');
    expect(cs.textIndent).toBe('2em');
    // Relative units (1em) are kept as-is by jsdom (no layout); assert the
    // token value the inline pass set, which is what survives the cascade.
    expect(p.style.getPropertyPriority('margin-top')).toBe('important');
    expect(p.style.getPropertyValue('margin-top')).toBe('1em');
  });

  it('CReader western typography wins over publisher class !important', () => {
    const publisherCss = '.calibre p { line-height: 2 !important; text-align: left !important; text-indent: 3em !important; }';
    const doc = docWithPublisherCss(
      '<div class="calibre"><p>English paragraph for the western cascade check.</p></div>',
      publisherCss,
    );
    forceReadingTypography(doc, CJK_STACK, 18, { lang: 'en' });

    const p = doc.querySelector('p')!;
    const cs = window.getComputedStyle(p);
    expect(cs.lineHeight).toBe('1.4');
    expect(cs.textAlign).toBe('justify');
    // Western token is `0`; resolved length is zero (jsdom keeps the bare 0).
    expect(cs.textIndent).toBe('0');
  });
});

describe('ensureSectionFontFaces', () => {
  it('prepends bundled @font-face rules into the section head', () => {
    const doc = docWith('<p>正文</p>');
    const css = '@font-face { font-family: "CReader LXGW WenKai"; }';
    ensureSectionFontFaces(doc, css);
    const style = doc.getElementById('creader-foliate-fonts') as HTMLStyleElement;
    expect(style).not.toBeNull();
    expect(doc.head.firstChild).toBe(style);
    expect(style.textContent).toBe(css);
  });
});
