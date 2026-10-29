// Builds an ASS subtitle file (captions, title card, notes, progress bar, letterbox) from a resolved look.
const BASE = 1080; // every size in styles.json is a fraction of this

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const px = (frac, scale = 1) => Math.round(frac * BASE * scale);

function rgb(hex) {
  const h = hex.replace('#', '').padEnd(6, '0');
  return { r: h.slice(0, 2), g: h.slice(2, 4), b: h.slice(4, 6) };
}
// &HAABBGGRR (alpha 00 = opaque) for style lines
const styleColor = (hex, alpha = 0) => {
  const { r, g, b } = rgb(hex);
  return `&H${Math.round(alpha * 255).toString(16).padStart(2, '0')}${b}${g}${r}`.toUpperCase();
};
// &HBBGGRR& for inline override tags
const tagColor = (hex) => {
  const { r, g, b } = rgb(hex);
  return `&H${b}${g}${r}&`.toUpperCase();
};

function stamp(t) {
  const cs = Math.round(Math.max(0, t) * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

const esc = (t) => t.replace(/[{}\\]/g, '').replace(/\n/g, ' ');
const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const applyCase = (t, c) => (c === 'upper' ? t.toUpperCase() : c === 'lower' ? t.toLowerCase() : t);

function styleLine(name, o) {
  const f = o.font;
  return [
    name,
    f.family,
    o.size,
    styleColor(o.primary),
    styleColor(o.primary),
    styleColor(o.outlineColor ?? '#000000', o.outlineAlpha ?? 0),
    styleColor(o.backColor ?? '#000000', o.backAlpha ?? 0.4),
    f.bold ? -1 : 0,
    f.italic ? -1 : 0,
    0,
    0,
    100,
    100,
    o.spacing ?? 0,
    0,
    o.borderStyle ?? 1,
    o.outline ?? 0,
    o.shadow ?? 0,
    o.alignment ?? 2,
    o.marginL ?? 60,
    o.marginR ?? 60,
    o.marginV ?? 0,
    1,
  ].join(',');
}

function groupWords(words, per, maxGap = 0.7) {
  const groups = [];
  let cur = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && (cur.length >= per || w.start - prev.end > maxGap || /[.!?]["')]*$/.test(prev.text))) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

// words: [{text, start, end}] already mapped onto the final (post-cut) timeline.
export function buildAss({ look, words, edit = {}, duration }) {
  const { style, format, position, scale } = look;
  const W = format.w;
  const H = format.h;
  const cap = style.caption;
  const letterbox = style.extras?.letterbox ?? 0;
  const barH = Math.round(H * letterbox);
  const emphasis = new Set((edit.emphasis || []).map(norm));

  // caption position
  const lowerMargin = cap.lowerMargin !== undefined ? Math.round(H * cap.lowerMargin) + barH : Math.round(H * format.safeBottom) + barH;
  const upperMargin = Math.round(H * (format.safeTop + 0.03)) + barH;
  const alignment = position === 'upper' ? 8 : position === 'middle' ? 5 : 2;
  const marginV = position === 'upper' ? upperMargin : position === 'middle' ? 0 : lowerMargin;

  const capSize = px(cap.size, scale);
  const capStyle = {
    font: look.captionFont,
    size: capSize,
    primary: look.text,
    outlineColor: cap.box ? cap.box.color : cap.outline,
    outlineAlpha: cap.box ? 1 - cap.box.alpha : 0,
    backColor: '#000000',
    backAlpha: 0.45,
    borderStyle: cap.box ? 3 : 1,
    outline: cap.box ? px(cap.box.pad) : px(cap.outlineWidth || 0, scale),
    shadow: px(cap.shadow || 0),
    spacing: px(cap.spacing || 0),
    alignment,
    marginV,
  };
  const noteFont = look.noteFont;
  const noteStyle = {
    font: noteFont,
    size: px(style.note?.size ?? 0.045),
    primary: style.note?.color ?? '#111111',
    outlineColor: style.note?.bg ?? '#FFD3E4',
    borderStyle: 3,
    outline: px(0.014),
    alignment: 5,
  };
  const titleStyle = {
    font: look.titleFont,
    size: px(style.title.accentSize),
    primary: look.text,
    outlineColor: style.title.outlineColor,
    outline: px(style.title.outline || 0),
    shadow: px(0.003),
    spacing: px(style.title.spacing || 0),
    alignment: 8,
    marginV: Math.round(H * (format.safeTop + 0.015)) + barH,
  };

  const lines = [];
  lines.push('[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '');
  lines.push(
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
  );
  lines.push('Style: ' + styleLine('Cap', capStyle));
  lines.push('Style: ' + styleLine('Note', noteStyle));
  lines.push('Style: ' + styleLine('Title', titleStyle));
  lines.push('Style: ' + styleLine('Bar', { font: look.captionFont, size: 10, primary: '#000000' }));
  lines.push('', '[Events]', 'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text');
  const ev = (layer, start, end, styleName, text) =>
    lines.push(`Dialogue: ${layer},${stamp(start)},${stamp(end)},${styleName},,0,0,0,,${text}`);

  // letterbox bars + progress bar
  if (barH) {
    const rect = (w, h) => `m 0 0 l ${w} 0 ${w} ${h} 0 ${h}`;
    ev(0, 0, duration, 'Bar', `{\\an7\\pos(0,0)\\1c&H000000&\\bord0\\shad0\\p1}${rect(W, barH)}{\\p0}`);
    ev(0, 0, duration, 'Bar', `{\\an7\\pos(0,${H - barH})\\1c&H000000&\\bord0\\shad0\\p1}${rect(W, barH)}{\\p0}`);
  }
  if (style.extras?.progressBar) {
    const h = Math.round(H * 0.006);
    const ms = Math.round(duration * 1000);
    ev(
      1,
      0,
      duration,
      'Bar',
      `{\\an7\\pos(0,${H - barH - h})\\1c${tagColor(look.accent)}\\bord0\\shad0\\fscx0\\t(0,${ms},\\fscx100)\\p1}m 0 0 l ${W} 0 ${W} ${h} 0 ${h}{\\p0}`,
    );
  }

  // title card
  const title = edit.title;
  if (title && (title.line1 || title.accent)) {
    const t = style.title;
    const dur = clamp(title.duration ?? 3.6, 1.5, Math.max(1.5, duration - 0.3));
    const f1 = look.line1Font;
    const f2 = look.titleFont;
    const one = (font, size, color, text, extra = '') =>
      `{\\fn${font.family}\\b${font.bold ? 1 : 0}\\i${font.italic ? 1 : 0}\\fs${px(size)}\\1c${tagColor(color)}${extra}}${esc(text)}`;
    const parts = [];
    if (title.line1) parts.push(one(f1, t.line1Size, look.text, applyCase(title.line1, t.line1Case)));
    if (title.accent) {
      const accentColor = t.accentColor && !look.userAccent ? t.accentColor : look.accent;
      parts.push(one(f2, t.accentSize, accentColor, applyCase(title.accent, t.accentCase)));
    }
    const blur = t.blur ? `\\blur${t.blur}` : '';
    ev(2, 0.15, 0.15 + dur, 'Title', `{\\fad(350,350)\\fscx92\\fscy92\\t(0,350,\\fscx100\\fscy100)${blur}}${parts.join('\\N')}`);
  }

  // notes (sticker-style callouts)
  for (const n of edit.notes || []) {
    const x = Math.round(W * (n.x ?? 0.7));
    const y = Math.round(H * (n.y ?? 0.34));
    const start = n.at ?? 1.5;
    ev(3, start, start + (n.duration ?? 3), 'Note', `{\\pos(${x},${y})\\frz-3\\fad(200,200)\\fscx90\\fscy90\\t(0,200,\\fscx100\\fscy100)}${esc(n.text)}`);
  }

  // captions
  const accentTag = tagColor(look.accent);
  const blurTag = cap.blur ? `\\blur${cap.blur}` : '';
  const render = (group, active) =>
    group
      .map((w, i) => {
        let text = applyCase(w.text, cap.case);
        if (cap.stripPunctuation) text = text.replace(/[.,;:!?"“”…]+$/g, '');
        text = esc(text);
        const isActive = active === i;
        if (isActive && (cap.mode === 'pop' || cap.mode === 'karaoke')) {
          const pop = cap.mode === 'pop' ? '\\fscx118\\fscy118\\t(0,110,\\fscx100\\fscy100)' : '';
          return `{\\1c${accentTag}${pop}}${text}{\\r}`;
        }
        if (emphasis.has(norm(w.text))) return `{\\1c${accentTag}}${text}{\\r}`;
        return text;
      })
      .join(' ');

  const groups = groupWords(words, cap.mode === 'oneword' ? 1 : cap.wordsPerLine);
  groups.forEach((group, gi) => {
    const nextStart = groups[gi + 1]?.[0].start ?? duration;
    const last = group[group.length - 1];
    const groupEnd = Math.min(last.end + 0.25, nextStart, duration);
    const pre = `{${blurTag}`;
    if (cap.mode === 'static' || cap.mode === 'oneword') {
      const fade = cap.mode === 'oneword' ? '\\fad(60,40)\\fscx92\\fscy92\\t(0,90,\\fscx100\\fscy100)' : '\\fad(120,60)';
      group.forEach((w, i) => {
        if (cap.mode === 'oneword') {
          ev(4, w.start, Math.min(group[i].end + 0.12, nextStart, duration), 'Cap', `${pre}${fade}}${render(group, i)}`);
        }
      });
      if (cap.mode === 'static') ev(4, group[0].start, groupEnd, 'Cap', `${pre}${fade}}${render(group, -1)}`);
    } else {
      // karaoke / pop: one event per spoken word so the highlight follows the voice
      group.forEach((w, i) => {
        const end = i < group.length - 1 ? group[i + 1].start : groupEnd;
        if (end > w.start) ev(4, w.start, end, 'Cap', `${pre}}${render(group, i)}`);
      });
    }
  });

  return lines.join('\n') + '\n';
}
