const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SAMPLE = 'This is how your captions will look once Claude has edited your reel'.split(' ');
const SIZE_SCALE = { small: 0.85, medium: 1, big: 1.2 };
const TEXT_COLORS = ['#FFFFFF', '#FFF4E0', '#111111'];
const ACCENT_COLORS = ['#FFE45C', '#FFB3D1', '#7CFFB2', '#7DF3FF', '#FF6B4A', '#C9B3FF', '#6EA8FF'];

const defaults = () => ({
  styleId: 'headline',
  format: '9x16',
  captionSize: 'medium',
  captionPosition: 'auto',
  fit: 'auto',
  tightenSilences: true,
  normalizeAudio: true,
  titleText: '',
});

const state = {
  config: null,
  job: null,
  step: 1,
  settings: defaults(),
  history: [],
  lastChange: '',
  poll: null,
  clock: 0,
};

const api = async (url, opts) => {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('on'), 3200);
}

/* ---------- look (mirrors lib/config.mjs resolveLook) ---------- */
const fontById = (id) => state.config.fonts.find((f) => f.id === id);
function look() {
  const s = state.settings;
  const style = state.config.styles.find((x) => x.id === s.styleId) || state.config.styles[0];
  return {
    style,
    format: state.config.formats[s.format] || state.config.formats['9x16'],
    position: s.captionPosition !== 'auto' ? s.captionPosition : style.caption.position,
    scale: SIZE_SCALE[s.captionSize] ?? 1,
    text: s.textColor || style.caption.color,
    accent: s.accentColor || style.caption.accent,
    userAccent: Boolean(s.accentColor),
    captionFont: fontById(s.captionFont || style.caption.font),
    titleFont: fontById(s.titleFont || style.title.accentFont),
    line1Font: fontById(style.title.line1Font),
    noteFont: fontById(s.noteFont || style.note?.font),
  };
}

function loadFonts() {
  const css = state.config.fonts
    .map(
      (f) =>
        `@font-face{font-family:'rs-${f.id}';src:url('/fonts/${f.file}');font-weight:${f.bold ? 700 : 400};font-style:${f.italic ? 'italic' : 'normal'};font-display:swap}`,
    )
    .join('\n');
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));
}
const fontCss = (f) => `font-family:'rs-${f.id}',sans-serif;font-weight:${f.bold ? 700 : 400};font-style:${f.italic ? 'italic' : 'normal'}`;
const applyCase = (t, c) => (c === 'upper' ? t.toUpperCase() : c === 'lower' ? t.toLowerCase() : t);

/* ---------- settings changes with undo ---------- */
function change(desc, fn) {
  state.history.push(structuredClone(state.settings));
  fn(state.settings);
  state.lastChange = desc;
  renderAll();
}
function undo() {
  if (!state.history.length) return;
  state.settings = state.history.pop();
  state.lastChange = 'Undid the last change';
  renderAll();
}

/* ---------- preview ---------- */
function gradeFilter(eq = '') {
  const parts = [];
  for (const kv of eq.split(':').filter(Boolean)) {
    const [k, v] = kv.split('=');
    const n = Number(v);
    if (k === 'contrast') parts.push(`contrast(${n})`);
    if (k === 'saturation') parts.push(`saturate(${n})`);
    if (k === 'brightness') parts.push(`brightness(${1 + n})`);
  }
  return parts.join(' ');
}

function applyLook() {
  const L = look();
  const { style, format } = L;
  const cap = style.caption;
  const screen = $('#screen');
  screen.style.aspectRatio = `${format.w} / ${format.h}`;
  screen.style.maxHeight = format.w > format.h ? 'none' : '68vh';
  $('.phone').style.maxWidth = format.w > format.h ? '100%' : `calc(68vh * ${format.w / format.h} + 20px)`;

  const vid = $('#vid');
  vid.style.filter = gradeFilter(style.grade?.eq);
  const ratio = (state.job?.meta ? state.job.meta.width / state.job.meta.height : vid.videoWidth / vid.videoHeight) || format.w / format.h;
  const fit = state.settings.fit !== 'auto' ? state.settings.fit : Math.abs(ratio / (format.w / format.h) - 1) <= 0.12 ? 'fill' : 'blur';
  vid.style.objectFit = fit === 'fill' ? 'cover' : 'contain';

  $('#vignette').style.opacity = style.grade?.vignette ? 1 : 0;
  const lb = style.extras?.letterbox || 0;
  $('#barTop').style.height = $('#barBottom').style.height = `${lb * 100}%`;
  const progress = $('#progress');
  progress.style.display = style.extras?.progressBar ? 'block' : 'none';
  progress.style.background = L.accent;

  // caption box
  const el = $('#cap');
  const c = el;
  const px = (f, k = 1) => `${(f * k * 100).toFixed(3)}cqmin`;
  const lower = (cap.lowerMargin ?? format.safeBottom) + lb;
  const upper = format.safeTop + 0.03 + lb;
  c.className = `cap ${cap.mode}`;
  const shadow = [];
  if (cap.shadow) shadow.push(`0 ${px(cap.shadow)} ${px(cap.shadow * 0.6)} rgba(0,0,0,.6)`);
  if (cap.blur && cap.outline && cap.outlineWidth) shadow.push(`0 0 ${px(cap.outlineWidth * 1.4)} ${cap.outline}`, `0 0 ${px(cap.outlineWidth * 3)} ${cap.outline}`);
  const box = cap.box
    ? `background:${hexA(cap.box.color, cap.box.alpha)};padding:${px(cap.box.pad)} ${px(cap.box.pad * 1.6)};display:inline-block;`
    : '';
  const pos =
    L.position === 'upper'
      ? `top:${upper * 100}cqh;`
      : L.position === 'middle'
        ? 'top:50%;transform:translateY(-50%);'
        : `bottom:${lower * 100}cqh;`;
  c.style.cssText =
    `${pos}${fontCss(L.captionFont)};font-size:${px(cap.size, L.scale)};color:${L.text};letter-spacing:${px(cap.spacing || 0)};` +
    (cap.outlineWidth && !cap.box ? `-webkit-text-stroke:${px(cap.outlineWidth * 2, L.scale)} ${cap.outline};paint-order:stroke fill;` : '') +
    (shadow.length ? `text-shadow:${shadow.join(',')};` : '');
  c.dataset.box = box;

  // title
  const t = style.title;
  const title = $('#title');
  title.style.cssText = `top:${(format.safeTop + 0.015 + lb) * 100}cqh;`;
  title.dataset.html = '';
  const accentColor = t.accentColor && !L.userAccent ? t.accentColor : L.accent;
  const tshadow = t.blur ? `0 0 ${px(t.outline * 1.4)} ${t.outlineColor},0 0 ${px(t.outline * 3)} ${t.outlineColor}` : `0 ${px(0.003)} ${px(0.004)} rgba(0,0,0,.5)`;
  const stroke = t.outline && !t.blur ? `-webkit-text-stroke:${px(t.outline * 2)} ${t.outlineColor};paint-order:stroke fill;` : '';
  const base = `letter-spacing:${px(t.spacing || 0)};text-shadow:${tshadow};${stroke}`;
  title.innerHTML =
    `<div style="${fontCss(L.line1Font)};font-size:${px(t.line1Size)};color:${L.text};${base}">${esc(applyCase('How I edit', t.line1Case))}</div>` +
    `<div style="${fontCss(L.titleFont)};font-size:${px(t.accentSize)};color:${accentColor};${base}">${esc(applyCase(state.settings.titleText || 'my videos', t.accentCase))}</div>`;

  // note
  const n = style.note || {};
  const note = $('#note');
  note.style.cssText = `left:68%;top:${(0.34 * 100).toFixed(0)}%;${fontCss(L.noteFont)};font-size:${px(n.size || 0.045)};color:${n.color};background:${n.bg};`;
  note.textContent = 'step 1: pick a style';
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

function tick() {
  const vid = $('#vid');
  const hasVideo = $('#screen').classList.contains('has-video');
  const t = hasVideo ? vid.currentTime : (performance.now() / 1000) % 14;
  const L = look();
  const cap = L.style.caption;
  const per = cap.mode === 'oneword' ? 1 : cap.wordsPerLine;
  const idx = Math.floor(t / 0.42) % SAMPLE.length;
  const g0 = Math.floor(idx / per) * per;
  const group = SAMPLE.slice(g0, g0 + per);
  const active = idx - g0;
  const html = group
    .map((w, i) => {
      let txt = applyCase(w, cap.case);
      if (cap.stripPunctuation) txt = txt.replace(/[.,;:!?]+$/, '');
      const on = (cap.mode === 'pop' || cap.mode === 'karaoke') && i === active;
      const color = on ? `style="color:${L.accent}"` : '';
      return `<span class="${on ? 'on' : ''}" ${color}>${esc(txt)}</span>`;
    })
    .join(' ');
  const el = $('#cap');
  const wrapped = cap.box ? `<span style="${el.dataset.box}">${html}</span>` : html;
  const key = wrapped + idx;
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    el.innerHTML = wrapped;
  }
  $('#title').style.opacity = t % 14 < 3.6 || (hasVideo && t < 3.6) ? 1 : 0;
  $('#note').style.opacity = t > 4.5 && t < 8 ? 1 : 0;
  if (hasVideo && vid.duration) $('#progress').style.width = `${(t / vid.duration) * 100}%`;
  else $('#progress').style.width = `${((t % 14) / 14) * 100}%`;
  state.clock = requestAnimationFrame(tick);
}

/* ---------- panels ---------- */
function renderStyles() {
  $('#styles').innerHTML = state.config.styles
    .map((s) => {
      const f = fontById(s.caption.font);
      return `<button class="style ${s.id === state.settings.styleId ? 'on' : ''}" data-style="${s.id}">
        <span class="ready">READY</span>
        <span class="nm" style="${fontCss(f)}">${esc(s.name)}</span>
        <span class="tg">${esc(s.tagline)}</span></button>`;
    })
    .join('');
}

function fontChips(target, key, label) {
  const sel = state.settings[key];
  $(target).innerHTML =
    `<button class="chip plain ${!sel ? 'on' : ''}" data-key="${key}" data-font="">Style default</button>` +
    state.config.fonts
      .map((f) => `<button class="chip ${sel === f.id ? 'on' : ''}" data-key="${key}" data-font="${f.id}" style="${fontCss(f)}" title="${esc(f.vibe)}">${esc(f.label)}</button>`)
      .join('');
}

function swatches(target, key, colors) {
  const cur = state.settings[key];
  $(target).innerHTML =
    `<button class="sw auto ${!cur ? 'on' : ''}" data-key="${key}" data-color="" title="Style default"></button>` +
    colors.map((c) => `<button class="sw ${cur?.toLowerCase() === c.toLowerCase() ? 'on' : ''}" style="background:${c}" data-key="${key}" data-color="${c}" title="${c}"></button>`).join('') +
    `<input type="color" data-key="${key}" value="${cur || '#ffffff'}" title="Pick any colour">`;
}

function seg(target, key, options) {
  $(target).innerHTML = options
    .map(([v, label]) => `<button data-key="${key}" data-val="${v}" class="${String(state.settings[key]) === String(v) ? 'on' : ''}">${esc(label)}</button>`)
    .join('');
}

function renderPanel2() {
  fontChips('#titleFonts', 'titleFont');
  fontChips('#captionFonts', 'captionFont');
  fontChips('#noteFonts', 'noteFont');
  swatches('#textColors', 'textColor', TEXT_COLORS);
  swatches('#accentColors', 'accentColor', ACCENT_COLORS);
  seg('#formats', 'format', Object.entries(state.config.formats).map(([k, f]) => [k, f.label]));
  seg('#sizes', 'captionSize', [['small', 'Small'], ['medium', 'Medium'], ['big', 'Big']]);
  seg('#positions', 'captionPosition', [['auto', 'Auto, away from your face'], ['upper', 'Top'], ['middle', 'Middle'], ['lower', 'Bottom']]);
  seg('#fits', 'fit', [['auto', 'Auto'], ['fill', 'Fill and crop'], ['blur', 'Blurred sides']]);
  $('#chkSilence').checked = state.settings.tightenSilences !== false;
  $('#chkLoud').checked = state.settings.normalizeAudio !== false;
  if (document.activeElement !== $('#titleText')) $('#titleText').value = state.settings.titleText || '';
}

function renderDock() {
  const style = look().style;
  $('#dockStyle').textContent = style.name;
  $('#dockChange').textContent = state.lastChange || 'No changes, the style as it is';
  $('#btnUndo').disabled = !state.history.length || state.step === 3;
  $('#btnBack').hidden = state.step !== 2;
  const next = $('#btnNext');
  next.hidden = false;
  if (state.step === 1) {
    next.textContent = 'Next: fonts and layout';
    next.disabled = false;
  } else if (state.step === 2) {
    next.textContent = 'Send to Claude';
    next.disabled = !state.job;
    next.title = state.job ? '' : 'Add a video first';
  } else {
    next.hidden = true;
  }
  $('#btnUndo').hidden = state.step === 3;
}

function renderSteps() {
  document.querySelectorAll('#steps button').forEach((b) => {
    const n = Number(b.dataset.step);
    b.classList.toggle('on', n === state.step);
    b.disabled = n === 3 && !(state.job && state.job.status !== 'uploaded');
  });
  for (const n of [1, 2, 3]) $(`#panel${n}`).hidden = state.step !== n;
}

function renderAll() {
  renderStyles();
  renderPanel2();
  renderSteps();
  renderDock();
  renderHandoff();
  applyLook();
}

/* ---------- hand-off and results ---------- */
const PROMPT = 'Edit my reel';
function renderHandoff() {
  const box = $('#handoff');
  const job = state.job;
  if (!job || state.step !== 3) return;
  const status = job.status;
  const msg = job.message || '';
  const pct = job.progress || 0;
  const key = [status, msg, pct, job.revision, job.output].join('|');
  if (box.dataset.key === key) return;
  box.dataset.key = key;

  if (status === 'submitted') {
    box.innerHTML = `<div class="status">
      <h3>Sent. Now ask Claude to edit it.</h3>
      <p>Your choices are saved. Switch to Claude (the app where you installed Reel Studio) and send this message:</p>
      <div class="prompt"><code>${PROMPT}</code><button class="primary" id="copyPrompt">Copy</button></div>
      <div class="meter"><div style="width:6%"></div></div>
      <p>Waiting for Claude. This page updates by itself.</p></div>`;
    $('#copyPrompt').onclick = async () => {
      try {
        await navigator.clipboard.writeText(PROMPT);
        toast('Copied. Paste it into Claude.');
      } catch {
        toast('Copy failed. Type it into Claude instead.');
      }
    };
  } else if (status === 'working') {
    box.innerHTML = `<div class="status"><h3>Claude is editing your reel</h3><p>${esc(msg || 'cuts, captions, sounds, your style')}</p><div class="meter"><div style="width:${pct}%"></div></div></div>`;
  } else if (status === 'done') {
    box.innerHTML = `<div class="status result"><h3>Your reel is ready</h3>
      <video controls playsinline src="/jobs/${job.id}/output?v=${job.revision}"></video>
      <div class="row"><a class="primary" href="/jobs/${job.id}/download">Download video</a><button class="ghost" id="again">Start another video</button></div>
      <div class="field"><label>Want changes? <small>Write them all here, one per line</small></label>
      <textarea id="revise" rows="3" placeholder="make the captions bigger&#10;remove the photos at the start"></textarea></div>
      <div class="row"><button class="ghost" id="sendRevise">Send changes to Claude</button></div></div>`;
    $('#again').onclick = () => newVideo();
    $('#sendRevise').onclick = () => {
      const lines = $('#revise').value.split('\n').map((s) => s.trim()).filter(Boolean);
      if (!lines.length) return toast('Write at least one change first.');
      submit(lines);
    };
  } else if (status === 'error') {
    box.innerHTML = `<div class="status"><h3>Something went wrong</h3><div class="error">${esc(msg)}</div>
      <p>Tell Claude what happened, or send it again.</p><div class="row"><button class="primary" id="retry">Send again</button></div></div>`;
    $('#retry').onclick = () => submit(job.changes || []);
  }
}

async function submit(changes) {
  try {
    const job = await api(`/api/jobs/${state.job.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: state.settings, changes }),
    });
    state.job = job;
    state.step = 3;
    $('#handoff').dataset.key = '';
    renderAll();
    startPolling();
  } catch (e) {
    toast(e.message);
  }
}

function startPolling() {
  clearInterval(state.poll);
  state.poll = setInterval(async () => {
    if (!state.job) return;
    try {
      const job = await api(`/api/jobs/${state.job.id}`);
      state.job = job;
      renderHandoff();
      renderSteps();
      if (job.status === 'done' || job.status === 'error') clearInterval(state.poll);
    } catch {}
  }, 1500);
}

/* ---------- jobs ---------- */
async function refreshJobs() {
  const jobs = await api('/api/jobs');
  const sel = $('#jobSelect');
  sel.innerHTML =
    '<option value="">New video</option>' +
    jobs.map((j) => `<option value="${j.id}" ${state.job?.id === j.id ? 'selected' : ''}>${esc(j.filename)} (${j.status})</option>`).join('');
}

function showVideo(job) {
  const vid = $('#vid');
  const screen = $('#screen');
  if (!job) {
    vid.removeAttribute('src');
    vid.load();
    screen.classList.remove('has-video');
    $('#dropText').innerHTML = '<b>Drop a video here</b> or click to choose one<br><small>mp4, mov, m4v, webm or mkv</small>';
    $('#drop').classList.remove('has');
    return;
  }
  vid.src = `/jobs/${job.id}/source`;
  vid.loop = true;
  vid.muted = true;
  screen.classList.add('has-video');
  vid.play().catch(() => {});
  const secs = job.meta?.duration ? `${Math.round(job.meta.duration)} seconds, ready to edit` : 'ready to edit';
  $('#dropText').innerHTML = `<b>${esc(job.filename)}</b><br><small>${secs}. Click to choose a different video.</small>`;
  $('#drop').classList.add('has');
}

function newVideo() {
  clearInterval(state.poll);
  state.job = null;
  state.step = 1;
  state.history = [];
  state.lastChange = '';
  showVideo(null);
  $('#jobSelect').value = '';
  renderAll();
}

async function loadJob(id) {
  const job = await api(`/api/jobs/${id}`);
  state.job = job;
  if (job.settings && job.settings.styleId) state.settings = { ...defaults(), ...job.settings };
  showVideo(job);
  state.step = job.status === 'uploaded' ? 1 : 3;
  $('#handoff').dataset.key = '';
  renderAll();
  refreshJobs();
  if (job.status === 'submitted' || job.status === 'working') startPolling();
}

function upload(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['mp4', 'mov', 'm4v', 'webm', 'mkv'].includes(ext)) return toast('Please choose an mp4, mov, m4v, webm or mkv video.');
  const bar = $('#upbar div');
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/jobs?name=${encodeURIComponent(file.name)}`);
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) bar.style.width = `${(e.loaded / e.total) * 100}%`;
  };
  xhr.onload = async () => {
    bar.style.width = '0';
    if (xhr.status !== 201) return toast(JSON.parse(xhr.responseText || '{}').error || 'Upload failed');
    state.job = JSON.parse(xhr.responseText);
    state.step = 1;
    showVideo(state.job);
    await refreshJobs();
    $('#jobSelect').value = state.job.id;
    renderAll();
    toast('Video added. Pick a style.');
  };
  xhr.onerror = () => {
    bar.style.width = '0';
    toast('Upload failed. Is the server still running?');
  };
  xhr.send(file);
}

/* ---------- wiring ---------- */
function wire() {
  $('#styles').addEventListener('click', (e) => {
    const b = e.target.closest('[data-style]');
    if (!b || b.dataset.style === state.settings.styleId) return;
    const name = state.config.styles.find((s) => s.id === b.dataset.style).name;
    change(`You picked ${name}`, (s) => {
      s.styleId = b.dataset.style;
      delete s.captionFont;
      delete s.titleFont;
      delete s.noteFont;
      delete s.textColor;
      delete s.accentColor;
    });
  });

  $('#panel2').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    const sw = e.target.closest('.sw');
    const sg = e.target.closest('.seg button');
    if (chip) {
      const { key, font } = chip.dataset;
      const label = { titleFont: 'title font', captionFont: 'caption font', noteFont: 'notes font' }[key];
      change(`You changed ${label}`, (s) => (font ? (s[key] = font) : delete s[key]));
    } else if (sw) {
      const { key, color } = sw.dataset;
      change(`You changed ${key === 'textColor' ? 'text' : 'accent'} colour`, (s) => (color ? (s[key] = color) : delete s[key]));
    } else if (sg) {
      const { key, val } = sg.dataset;
      change(`You changed ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}`, (s) => (s[key] = val));
    }
  });
  $('#panel2').addEventListener('input', (e) => {
    if (e.target.type === 'color') {
      const { key } = e.target.dataset;
      state.settings[key] = e.target.value;
      state.lastChange = `You changed ${key === 'textColor' ? 'text' : 'accent'} colour`;
      applyLook();
      renderDock();
    }
  });
  // snapshot once when the colour picker opens so Undo restores the colour from before
  $('#panel2').addEventListener('pointerdown', (e) => {
    if (e.target.type === 'color') state.history.push(structuredClone(state.settings));
  });
  $('#panel2').addEventListener('change', (e) => {
    if (e.target.type === 'color') renderAll();
  });
  $('#chkSilence').onchange = (e) => change('You changed pause cutting', (s) => (s.tightenSilences = e.target.checked));
  $('#chkLoud').onchange = (e) => change('You changed volume levelling', (s) => (s.normalizeAudio = e.target.checked));
  $('#titleText').oninput = (e) => {
    state.settings.titleText = e.target.value;
    state.lastChange = 'You wrote a title';
    applyLook();
    renderDock();
  };

  $('#btnUndo').onclick = undo;
  $('#btnBack').onclick = () => ((state.step = 1), renderAll());
  $('#btnNext').onclick = () => {
    if (state.step === 1) {
      state.step = 2;
      renderAll();
    } else if (state.step === 2) {
      const lines = $('#changes').value.split('\n').map((s) => s.trim()).filter(Boolean);
      submit(lines);
    }
  };
  $('#steps').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    state.step = Number(b.dataset.step);
    $('#handoff').dataset.key = '';
    renderAll();
  });

  const drop = $('#drop');
  $('#file').onchange = (e) => e.target.files[0] && upload(e.target.files[0]);
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add('over'))));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]);
  });

  $('#jobSelect').onchange = (e) => (e.target.value ? loadJob(e.target.value) : newVideo());
  const vid = $('#vid');
  $('#btnPlay').onclick = () => ((vid.muted = false), vid.play().catch(() => {}));
  $('#btnPause').onclick = () => vid.pause();
  $('#btnMoment').onclick = () => {
    if (vid.duration) vid.currentTime = Math.random() * Math.max(0, vid.duration - 4);
  };
  vid.addEventListener('loadedmetadata', applyLook);
  $('#chkSafe').onchange = (e) => $('#safe').classList.toggle('on', e.target.checked);
}

async function init() {
  state.config = await api('/api/config');
  loadFonts();
  wire();
  renderAll();
  await refreshJobs();
  tick();
  const params = new URLSearchParams(location.search);
  if (params.get('job')) loadJob(params.get('job')).catch(() => {});
  if (!state.config.ffmpeg) toast('ffmpeg was not found. Ask Claude to run the setup, then restart.');
}
init();
