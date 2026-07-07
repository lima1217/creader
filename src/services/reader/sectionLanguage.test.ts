import { describe, expect, it } from 'vitest';
import {
  detectDominantLangTag,
  resolveSectionLanguage,
} from './sectionLanguage';

function docWith(html: string, lang = ''): Document {
  const doc = document.implementation.createHTMLDocument('section');
  if (lang) doc.documentElement.lang = lang;
  doc.body.innerHTML = html;
  return doc;
}

describe('detectDominantLangTag', () => {
  it('detects Chinese from Han-heavy samples', () => {
    const text = '无论是对热那亚商人对神圣罗马帝国皇帝选举的操控，或是美国南方种植园主对奴隶制的维护，商贸秩序的建立并非来源于';
    expect(detectDominantLangTag(text)).toBe('zh');
  });

  it('detects English from Latin-heavy samples', () => {
    const text = 'The establishment of commercial order did not originate from abstract principles alone but from concrete balances of power among merchants, states, and social groups across centuries of negotiation.';
    expect(detectDominantLangTag(text)).toBe('en');
  });

  it('detects Japanese when kana is present', () => {
    const text = 'これは日本語のテスト文章です。漢字も含まれていますが、ひらがなとカタカナが十分にあります。';
    expect(detectDominantLangTag(text)).toBe('ja');
  });

  it('returns null for very short samples', () => {
    expect(detectDominantLangTag('短文本')).toBeNull();
  });
});

describe('resolveSectionLanguage', () => {
  it('keeps declared lang when it matches content', () => {
    const doc = docWith('<p>Hello world, this is an English paragraph with enough Latin letters.</p>', 'en');
    expect(resolveSectionLanguage(doc)).toBe('en');
  });

  it('infers Chinese when lang metadata is missing', () => {
    const doc = docWith('<p>无论是对热那亚商人对神圣罗马帝国皇帝选举的操控，或是美国南方种植园主对奴隶制的维护。</p>');
    expect(resolveSectionLanguage(doc)).toBe('zh');
  });

  it('overrides wrong declared lang when content strongly disagrees', () => {
    const doc = docWith(
      '<p>无论是对热那亚商人对神圣罗马帝国皇帝选举的操控，或是美国南方种植园主对奴隶制的维护，商贸秩序的建立并非来源于。</p>',
      'en',
    );
    expect(resolveSectionLanguage(doc)).toBe('zh');
  });

  it('falls back to OPF book language when section metadata and sample are empty', () => {
    const doc = docWith('<p>短</p>');
    expect(resolveSectionLanguage(doc, 'zh-CN')).toBe('zh-CN');
  });
});
