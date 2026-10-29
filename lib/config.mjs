import fs from 'node:fs';
import { STYLES_FILE, FONTS_FILE } from './paths.mjs';

// All sizes in styles.json are fractions of the short side (1080 px in every format).
export const FORMATS = {
  '9x16': { label: '9:16 Reel', w: 1080, h: 1920, safeTop: 0.12, safeBottom: 0.2 },
  '4x5': { label: '4:5 Feed', w: 1080, h: 1350, safeTop: 0.06, safeBottom: 0.1 },
  '1x1': { label: '1:1 Square', w: 1080, h: 1080, safeTop: 0.06, safeBottom: 0.08 },
  '16x9': { label: '16:9 Wide', w: 1920, h: 1080, safeTop: 0.06, safeBottom: 0.08 },
};

export const SIZE_SCALE = { small: 0.85, medium: 1, big: 1.2 };

export const loadStyles = () => JSON.parse(fs.readFileSync(STYLES_FILE, 'utf8'));
export const loadFonts = () => JSON.parse(fs.readFileSync(FONTS_FILE, 'utf8'));

// Merge a style's defaults with what the user picked in the UI and what Claude decided in edit.json.
export function resolveLook(settings = {}, edit = {}) {
  const styles = loadStyles();
  const fonts = Object.fromEntries(loadFonts().map((f) => [f.id, f]));
  const style = styles.find((s) => s.id === settings.styleId) || styles[0];
  const format = FORMATS[settings.format] || FORMATS['9x16'];
  const pick = (id, fallback) => fonts[id] || fonts[fallback];
  const position =
    settings.captionPosition && settings.captionPosition !== 'auto'
      ? settings.captionPosition
      : edit.captionPosition || style.caption.position;
  return {
    style,
    format,
    formatId: FORMATS[settings.format] ? settings.format : '9x16',
    position,
    scale: SIZE_SCALE[settings.captionSize] ?? 1,
    text: settings.textColor || style.caption.color,
    accent: settings.accentColor || style.caption.accent,
    userAccent: Boolean(settings.accentColor),
    captionFont: pick(settings.captionFont || style.caption.font, 'poppins-bold'),
    titleFont: pick(settings.titleFont || style.title.accentFont, 'poppins-bold'),
    line1Font: pick(style.title.line1Font, 'poppins-bold'),
    noteFont: pick(settings.noteFont || style.note?.font, 'kalam'),
  };
}
