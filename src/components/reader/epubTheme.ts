import type { Rendition } from 'epubjs';
import type { Theme } from '../../types';

const themeStyles: Record<Theme, { body: { color: string; background: string }; link: string }> = {
  light: {
    body: { color: '#1F2933', background: '#FBF7EF' },
    link: '#264466',
  },
  dark: {
    body: { color: '#e6edf3', background: '#0d1117' },
    link: '#58a6ff',
  },
};

export function applyEpubTheme(
  rendition: Rendition,
  options: { theme: Theme; fontFamily: string; fontSize: number; lineHeight: number }
) {
  const currentTheme = themeStyles[options.theme];
  rendition.themes.default({
    body: {
      'font-family': `${options.fontFamily}, Georgia, serif`,
      'font-size': `${options.fontSize}px`,
      'line-height': `${options.lineHeight}`,
      'color': `${currentTheme.body.color} !important`,
      'background': `${currentTheme.body.background} !important`,
      'padding': '20px !important',
      'margin': '0 auto !important',
    },
    'p': {
      'margin-bottom': '1em',
      'color': `${currentTheme.body.color} !important`,
    },
    'h1, h2, h3, h4, h5, h6': {
      'color': `${currentTheme.body.color} !important`,
    },
    'a': {
      'color': `${currentTheme.link} !important`,
    },
    'span, div': {
      'color': `${currentTheme.body.color} !important`,
    },
  });
}
