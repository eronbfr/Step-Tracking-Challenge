// Story composer: camera (tap = photo, hold = video), gallery or "Aa" text story → editor with filters (swipe),
// text, stickers, drawing, pinch / rotate / drag on everything → export (js/storykit.js) → onPost({ blob, meta }).
import * as K from './storykit.js';
import { t, tn } from './i18n.js';
import { esc, icon, toast, fmt, reducedMotion, lockScroll, unlockScroll } from './ui.js';

const EMOJIS = ['👟', '🏃‍♀️', '🏃‍♂️', '🚶‍♀️', '🚶‍♂️', '🔥', '💪', '🎉', '🏆', '🥇', '✅', '💯', '⚡', '❤️', '😍', '😂', '😎', '🤩', '🥵', '😴',
  '🌞', '🌙', '🌧️', '🌈', '🌊', '⛰️', '🌳', '🌮', '🫓', '🥟', '🍫', '🍕', '☕', '🥤', '🍎', '🎧', '🎶', '📸', '🗺️', '🌎',
  '🇧🇷', '🇲🇽', '🇺🇾', '🇨🇴', '👏', '🙌', '✨', '⭐', '💥', '🚀'];
const TEXT_NAMES = { classic: 'st.font.classic', modern: 'st.font.modern', neon: 'st.font.neon', typewriter: 'st.font.typewriter', strong: 'st.font.strong', serif: 'st.font.serif' };
const CSS_FONTS = {
  classic: 'font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-weight: 700;',
  modern: 'font-family: "Avenir Next Condensed", "Roboto Condensed", "Arial Narrow", sans-serif; font-weight: 800; text-transform: uppercase; letter-spacing: .03em;',
  neon: 'font-family: ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif; font-weight: 600;',
  typewriter: 'font-family: "American Typewriter", "Courier New", ui-monospace, monospace; font-weight: 600;',
  strong: 'font-family: "Arial Black", "Helvetica Neue", Impact, sans-serif; font-weight: 900; font-style: italic; text-transform: uppercase;',
  serif: 'font-family: Didot, "Bodoni 72", Georgia, "Times New Roman", serif; font-weight: 600; font-style: italic;',
};
const HOLD_MS = 280;
const MAX_PICK_BYTES = 300 * 1024 * 1024; // gallery videos are copied into memory (see pickFile)

let S = null;
addEventListener('popstate', () => { if (S && S.pushed) { S.pushed = false; close(); } }); // Android back button

/**
 * Opens the composer. info = { me: { id, first, avatarHtml }, steps, goal, streak, rank, M, day, N, live, place, members: [{ id, first }] }
 * preset: 'steps' starts a text story with today's steps. onPost({ blob, meta }) receives the finished story.
 */
export function openComposer({ info, onPost, preset = '' }) {
  let pushed = false;
  if (S) { pushed = S.pushed; S.pushed = false; close(true); }
  const el = document.createElement('div');
  el.className = 'cmp';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', t('st.new'));
  el.innerHTML = `
    <div class="cmp-stage">
      <video class="cmp-cam" playsinline muted autoplay></video>
      <canvas class="cmp-gl" hidden></canvas>
      <canvas class="cmp-draw"></canvas>
      <div class="cmp-items"></div>
      <i class="cmp-guide v"></i><i class="cmp-guide h"></i>
      <div class="cmp-fname" aria-live="polite"></div>
      <div class="cmp-trash" aria-hidden="true">${icon('trash', 26)}</div>
      <div class="cmp-flash"></div>
      <div class="cmp-camfail" hidden>
        <span class="cmp-camfail-ic">${icon('camera', 34)}</span>
        <b>${t('st.c.noCamera')}</b><p>${t('st.c.noCameraText')}</p>
        <button class="cmp-pill light" data-c="gallery">${icon('image', 20)} ${t('st.c.gallery')}</button>
        <button class="cmp-pill" data-c="aa">Aa ${t('st.c.textStory')}</button>
      </div>
    </div>
    <div class="cmp-top"></div>
    <div class="cmp-bottom"></div>
    <input type="file" accept="image/*,video/*" hidden data-file>
    <i class="cmp-probe t"></i><i class="cmp-probe b"></i>`;
  document.body.appendChild(el);
  lockScroll();
  S = {
    el, info, onPost, stage: el.querySelector('.cmp-stage'), cam: el.querySelector('.cmp-cam'), glc: el.querySelector('.cmp-gl'),
    drawC: el.querySelector('.cmp-draw'), itemsEl: el.querySelector('.cmp-items'), top: el.querySelector('.cmp-top'), bottom: el.querySelector('.cmp-bottom'),
    mode: '', media: { kind: 'none', el: null, w: 0, h: 0 }, tf: { x: K.W / 2, y: K.H / 2, s: 1, r: 0, flip: false }, filter: 0, bg: K.GRADIENTS[0], grad: 0,
    items: [], strokes: [], brush: { tool: 'pen', color: '#ffffff', size: 14 }, facing: 'user', stream: null, fromCamera: false, dpr: Math.min(2, devicePixelRatio || 1),
    raf: 0, busy: false, lastFont: 'classic', pushed,
  };
  if (!S.pushed) try { history.pushState({ cmp: 1 }, ''); S.pushed = true; } catch { /* sandboxed */ }
  S.renderer = new K.Renderer(S.glc);
  S.renderer.onrestore = requestDraw;
  layout();
  bind();
  requestAnimationFrame(() => el.classList.add('in'));
  if (preset === 'steps') startText(true);
  else startCamera();
}

function close(immediate = false) {
  if (!S) return;
  const s = S;
  S = null;
  stopCamera(s);
  cancelAnimationFrame(s.raf);
  if (s.media.kind === 'video') { s.media.el.pause(); URL.revokeObjectURL(s.media.url); }
  s.renderer.dispose();
  unlockScroll();
  if (s.pushed) { s.pushed = false; try { history.back(); } catch { /* ignore */ } }
  if (s.vv) visualViewport.removeEventListener('resize', s.vv);
  removeEventListener('resize', layout);
  if (immediate || reducedMotion()) return s.el.remove();
  s.el.classList.remove('in');
  setTimeout(() => s.el.remove(), 260);
}

const dirty = () => S && (S.items.length || S.strokes.length || S.media.kind !== 'none');
function askClose() {
  if (S.mode === 'edit' && dirty() && !confirm(t('st.c.discard'))) return;
  close();
}

/* ═════════════ Layout ═════════════ */
function layout() {
  if (!S || S.mode === 'text') return; // the keyboard resizes the viewport: keep the stage still while typing
  const sat = S.el.querySelector('.cmp-probe.t').offsetHeight, sab = S.el.querySelector('.cmp-probe.b').offsetHeight;
  const vw = innerWidth, vh = innerHeight - sat - sab;
  let sw = Math.min(vw, 560), sh = (sw * 16) / 9;
  const bar = 78;
  S.el.classList.toggle('roomy', sh + bar <= vh);
  if (sh > vh - (sh + bar <= vh ? bar : 0)) { sh = Math.min(sh, vh); sw = (sh * 9) / 16; }
  S.sw = sw; S.sh = sh; S.sc = sw / K.W;
  S.el.style.setProperty('--sw', `${sw}px`);
  S.el.style.setProperty('--sh', `${sh}px`);
  const gw = Math.min(K.W, Math.round(sw * S.dpr));
  if (S.glc.width !== gw) { S.glc.width = gw; S.glc.height = Math.round((gw * K.H) / K.W); }
  S.drawC.width = Math.round(sw * S.dpr); S.drawC.height = Math.round(sh * S.dpr);
  redrawStrokes();
  S.items.forEach(it => { paintItem(it); place(it); });
  requestDraw();
}

/* ═════════════ Camera ═════════════ */
async function startCamera() {
  S.mode = 'camera';
  S.el.dataset.mode = 'camera';
  S.glc.hidden = true;
  S.cam.hidden = false;
  ui();
  const fail = S.el.querySelector('.cmp-camfail');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { fail.hidden = false; S.el.classList.add('nocam'); return; }
  try {
    const video = { facingMode: S.facing, width: { ideal: 1920 }, height: { ideal: 1080 } };
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video, audio: true }); } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.name === 'NotReadableError')) stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      else throw e;
    }
    if (!S || S.mode !== 'camera') { stream.getTracks().forEach(tr => tr.stop()); return; }
    S.stream = stream;
    S.cam.srcObject = stream;
    S.cam.classList.toggle('mirror', S.facing === 'user');
    await S.cam.play().catch(() => {});
    fail.hidden = true;
    S.el.classList.remove('nocam');
  } catch {
    if (!S) return;
    fail.hidden = false;
    S.el.classList.add('nocam');
  }
}

function stopCamera(s = S) {
  if (!s) return;
  if (s.recorder && s.recorder.state !== 'inactive') { s.discardRec = true; s.recorder.stop(); }
  if (s.stream) s.stream.getTracks().forEach(tr => tr.stop());
  s.stream = null;
  s.cam.srcObject = null;
}

function snapPhoto() {
  const v = S.cam;
  if (!v.videoWidth) return;
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const x = c.getContext('2d');
  if (S.facing === 'user') { x.translate(c.width, 0); x.scale(-1, 1); }
  x.drawImage(v, 0, 0);
  const fl = S.el.querySelector('.cmp-flash');
  fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
  S.fromCamera = true;
  useMedia({ kind: 'image', el: c, w: c.width, h: c.height }, true);
}

function startRecording() {
  const mime = K.recorderMime();
  if (!S.stream || !mime) return false;
  const chunks = [];
  let rec;
  try { rec = new MediaRecorder(S.stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 }); } catch { return false; }
  S.recorder = rec;
  S.discardRec = false;
  rec.ondataavailable = e => e.data && e.data.size && chunks.push(e.data);
  rec.onstop = async () => {
    const s = S;
    if (!s || s.discardRec) return;
    const du = (performance.now() - s.recT0) / 1000;
    if (du < 0.6) { toast(t('st.c.holdLonger')); return; }
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    s.fromCamera = true;
    await loadVideo(blob, du, s.facing === 'user');
  };
  rec.start(250);
  S.recT0 = performance.now();
  S.el.classList.add('recording');
  const tick = () => {
    if (!S || !S.recorder || S.recorder.state !== 'recording') return;
    const p = (performance.now() - S.recT0) / 1000 / K.MAX_VIDEO_SECONDS;
    S.el.style.setProperty('--rec', `${Math.min(100, p * 100)}%`);
    if (p >= 1) stopRecording(); else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  if (navigator.vibrate) navigator.vibrate(15);
  return true;
}

function stopRecording() {
  if (!S || !S.recorder) return;
  S.el.classList.remove('recording');
  S.el.style.setProperty('--rec', '0%');
  if (S.recorder.state !== 'inactive') S.recorder.stop();
  S.recorder = null;
}

/* ═════════════ Media in ═════════════ */
async function pickFile(file) {
  if (!file) return;
  try {
    // Android's photo picker lends the file for a few seconds only: the preview kept playing from its buffer, but the
    // export reads the file again and failed ("Couldn't prepare the story"). Keep our own copy in memory.
    if (file.type.startsWith('video/')) {
      if (file.size > MAX_PICK_BYTES) { toast(t('st.tooLarge'), { type: 'warn', duration: 5000 }); return; }
      return await loadVideo(new Blob([await file.arrayBuffer()], { type: file.type }), 0, false);
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    const max = 2160, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    S.fromCamera = false;
    useMedia({ kind: 'image', el: c, w: c.width, h: c.height }, false);
  } catch {
    toast(t('st.c.badFile'), { type: 'warn' });
  }
}

async function loadVideo(blob, knownDu, mirror) {
  if (!K.canRecordVideo()) { toast(t('st.c.noVideo'), { type: 'warn', duration: 5000 }); return; }
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.className = 'cmp-vsrc';
  v.playsInline = true; v.setAttribute('playsinline', ''); v.muted = true; v.loop = false; v.preload = 'auto'; v.src = url;
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; setTimeout(res, 6000); }).catch(() => null);
  if (!S) return;
  if (!v.videoWidth) { toast(t('st.c.badFile'), { type: 'warn' }); URL.revokeObjectURL(url); return; }
  if (!Number.isFinite(v.duration)) { // recorded WebM has no duration until you seek to the end
    v.currentTime = 1e7;
    await new Promise(res => { v.ondurationchange = () => Number.isFinite(v.duration) && res(); setTimeout(res, 2500); });
    v.currentTime = 0;
  }
  if (!S) return;
  const du = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : knownDu || K.MAX_VIDEO_SECONDS;
  useMedia({ kind: 'video', el: v, w: v.videoWidth, h: v.videoHeight, url, du, trim: [0, Math.min(du, K.MAX_VIDEO_SECONDS)], muted: false }, mirror);
}

function useMedia(media, mirror) {
  if (S.media.kind === 'video') { S.media.el.pause(); S.media.el.remove(); URL.revokeObjectURL(S.media.url); }
  stopCamera();
  S.media = media;
  S.tf = { ...K.fitTransform(media.w, media.h), flip: false };
  if (S.fromCamera) S.tf.s = Math.max(K.W / media.w, K.H / media.h); // the camera preview was full-bleed
  if (media.kind === 'video') {
    S.tf.flip = !!mirror;
    S.stage.appendChild(media.el);
    media.el.muted = true;
    media.el.addEventListener('timeupdate', () => { if (S && S.media === media && media.el.currentTime >= media.trim[1] - 0.05) media.el.currentTime = media.trim[0]; });
    media.el.addEventListener('ended', () => { if (S && S.media === media) { media.el.currentTime = media.trim[0]; media.el.play().catch(() => {}); } });
    media.el.play().catch(() => {});
    S.bg = K.bgColors(media.el);
  } else {
    S.bg = K.bgColors(media.el);
  }
  S.renderer.source(media.el);
  edit();
}

function startText(steps = false) {
  stopCamera();
  S.media = { kind: 'none', el: null, w: 0, h: 0 };
  S.renderer.source(null);
  S.bg = K.GRADIENTS[S.grad];
  S.fromCamera = false;
  edit();
  if (steps) {
    const I = S.info;
    addSticker({ kind: 'goal', label: `${Math.min(999, Math.round((I.steps / I.goal) * 100))}%`, sub: t('st.k.goalSub'), value: I.steps / I.goal, style: 0 }, { y: 760, quiet: true });
    addSticker({ kind: 'pill', icon: '👟', label: `${fmt(I.steps)} ${t('unit.steps')}`, style: 1 }, { y: 1180, quiet: true });
  } else {
    openText(null);
  }
}

/* ═════════════ Editor ═════════════ */
function edit() {
  S.mode = 'edit';
  S.el.dataset.mode = 'edit';
  S.cam.hidden = true;
  S.glc.hidden = false;
  S.el.querySelector('.cmp-camfail').hidden = true;
  S.el.classList.remove('nocam');
  ui();
  loop();
}

function loop() {
  cancelAnimationFrame(S.raf);
  const frame = () => {
    if (!S) return;
    if (S.media.kind === 'video' || S.needDraw) { S.needDraw = false; draw(); }
    S.raf = requestAnimationFrame(frame);
  };
  S.raf = requestAnimationFrame(frame);
}
const requestDraw = () => { if (S) S.needDraw = true; };
const draw = () => S.renderer.draw({ tf: S.tf, filter: S.filter, bg: S.bg, mw: S.media.w, mh: S.media.h });

function ui() {
  const m = S.mode;
  const back = `<button class="cmp-icon" data-c="${m === 'edit' && S.fromCamera ? 'retake' : 'close'}" aria-label="${esc(t('common.close'))}">${icon(m === 'edit' && S.fromCamera ? 'back' : 'close', 26)}</button>`;
  if (m === 'camera') {
    S.top.innerHTML = `${back}<span class="cmp-sp"></span>`;
    S.bottom.innerHTML = `
      <p class="cmp-hint">${K.canRecordVideo() ? t('st.c.hint') : t('st.c.hintPhoto')}</p>
      <div class="cmp-shoot">
        <button class="cmp-round" data-c="gallery" aria-label="${esc(t('st.c.gallery'))}">${icon('image', 24)}</button>
        <button class="cmp-shutter" data-c="shutter" aria-label="${esc(t('st.c.shutter'))}"><i></i></button>
        <button class="cmp-round" data-c="flip" aria-label="${esc(t('st.c.flip'))}">${icon('flip', 24)}</button>
      </div>
      <div class="cmp-modes"><button class="on">${t('st.c.story')}</button><button data-c="aa">Aa ${t('st.c.create')}</button></div>`;
    return;
  }
  if (m !== 'edit') return;
  const video = S.media.kind === 'video';
  S.top.innerHTML = `${back}<span class="cmp-sp"></span>
    ${S.media.kind === 'none' ? `<button class="cmp-icon grad" data-c="grad" aria-label="${esc(t('st.c.background'))}" style="--g1:rgb(${S.bg[0]});--g2:rgb(${S.bg[1]})"><i></i></button>` : ''}
    ${video ? `<button class="cmp-icon" data-c="mute" aria-label="${esc(t('st.c.sound'))}">${icon(S.media.muted ? 'muted' : 'sound', 24)}</button>` : ''}
    <button class="cmp-icon" data-c="text" aria-label="${esc(t('st.c.text'))}"><span class="cmp-aa">Aa</span></button>
    <button class="cmp-icon" data-c="stickers" aria-label="${esc(t('st.c.stickers'))}">${icon('sticker', 25)}</button>
    <button class="cmp-icon" data-c="draw" aria-label="${esc(t('st.c.draw'))}">${icon('draw', 25)}</button>
    ${S.media.kind !== 'none' ? `<button class="cmp-icon" data-c="filters" aria-label="${esc(t('st.c.filters'))}">${icon('sparkle', 25)}</button>` : ''}
    <button class="cmp-icon" data-c="save" aria-label="${esc(t('st.c.save'))}">${icon('install', 24)}</button>`;
  const trim = video && S.media.du > K.MAX_VIDEO_SECONDS + 0.2;
  S.bottom.innerHTML = `
    ${trim ? `<label class="cmp-trim"><span>${t('st.c.trim')} <b data-trim-label></b></span>
      <input type="range" min="0" max="${(S.media.du - K.MAX_VIDEO_SECONDS).toFixed(1)}" step="0.1" value="${S.media.trim[0]}" data-trim></label>` : ''}
    <div class="cmp-filters" hidden></div>
    <div class="cmp-post">
      <span class="cmp-tip">${S.media.kind === 'none' ? '' : t('st.c.swipeTip')}</span>
      <button class="cmp-share" data-c="post">${S.info.me.avatarHtml}<b>${t('st.c.yourStory')}</b>${icon('chevron', 18)}</button>
    </div>`;
  if (trim) trimLabel();
}

function trimLabel() {
  const l = S.el.querySelector('[data-trim-label]');
  const f = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  if (l) l.textContent = `${f(S.media.trim[0])}–${f(S.media.trim[1])}`;
}

/* ═════════════ Items (text & stickers) ═════════════ */
function paintItem(it) {
  const k = Math.min(4, S.sc * S.dpr * it.s);
  const c = K.renderItem(it, k);
  c.style.width = `${(c.width / k) * S.sc * it.s}px`;
  c.style.height = `${(c.height / k) * S.sc * it.s}px`;
  it.el.replaceChildren(c);
  it.rs = it.s;
}
function place(it) {
  it.el.style.transform = `translate(${it.x * S.sc}px, ${it.y * S.sc}px) translate(-50%, -50%) rotate(${it.r}rad) scale(${it.s / it.rs})`;
}
function mount(it, pop = true) {
  it.el = document.createElement('div');
  it.el.className = `cmp-item${pop && !reducedMotion() ? ' pop' : ''}`;
  it.el.dataset.kind = it.type;
  S.itemsEl.appendChild(it.el);
  paintItem(it);
  place(it);
  S.items.push(it);
}
function addSticker(d, { y = 900, quiet = false } = {}) {
  mount({ type: 'sticker', d, x: K.W / 2, y, s: 1, r: quiet ? 0 : (Math.random() - 0.5) * 0.2 });
}
const itemOf = el => S.items.find(it => it.el === el);
function toFront(it) {
  S.items = [...S.items.filter(x => x !== it), it];
  S.itemsEl.appendChild(it.el);
}
function removeItem(it) {
  S.items = S.items.filter(x => x !== it);
  it.el.remove();
}

/* ═════════════ Text tool ═════════════ */
function openText(item) {
  S.mode = 'text';
  S.el.dataset.mode = 'text';
  const d = item ? { ...item.d } : { text: '', font: S.lastFont, color: '#ffffff', bg: 0, align: 'center', size: 76 };
  if (item) item.el.style.visibility = 'hidden';
  const box = document.createElement('div');
  box.className = 'cmp-text';
  box.innerHTML = `
    <div class="cmp-text-top">
      <button class="cmp-icon" data-t="align" aria-label="${esc(t('st.c.align'))}"></button>
      <button class="cmp-icon cmp-abtn" data-t="bg" aria-label="${esc(t('st.c.textBg'))}">A</button>
      <span class="cmp-sp"></span>
      <button class="cmp-done" data-t="done">${t('st.c.done')}</button>
    </div>
    <div class="cmp-size"><input type="range" min="40" max="160" value="${d.size}" aria-label="${esc(t('st.c.size'))}"></div>
    <div class="cmp-text-area"><div class="cmp-tmirror" aria-hidden="true"><span></span></div><textarea rows="1" maxlength="220" autocapitalize="sentences" spellcheck="false" aria-label="${esc(t('st.c.text'))}"></textarea></div>
    <div class="cmp-text-bottom">
      <div class="cmp-fonts">${K.TEXT_STYLES.map(s => `<button data-font="${s.id}" style='${CSS_FONTS[s.id]}'>${t(TEXT_NAMES[s.id])}</button>`).join('')}</div>
      <div class="cmp-colors">${K.COLORS.map(c => `<button data-color="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}</div>
    </div>`;
  S.el.appendChild(box);
  const ta = box.querySelector('textarea'), mir = box.querySelector('.cmp-tmirror span'), area = box.querySelector('.cmp-text-area');
  ta.value = d.text;
  const light = c => { const n = parseInt(c.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 170; };
  const sync = () => {
    d.text = ta.value;
    mir.textContent = ta.value + '​';
    const px = d.size * S.sc;
    area.style.cssText = `${CSS_FONTS[d.font]} --px:${px}px; text-align:${d.align};`;
    const ink = d.bg === 1 ? (light(d.color) ? '#111' : '#fff') : d.font === 'neon' ? '#fff' : d.color;
    ta.style.color = ink;
    ta.style.textShadow = d.font === 'neon' ? `0 0 ${px * 0.35}px ${d.color}, 0 0 ${px * 0.12}px ${d.color}` : d.bg ? 'none' : '0 1px 4px rgba(0,0,0,.3)';
    mir.style.background = d.bg === 1 ? d.color : d.bg === 2 ? (light(d.color) ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.72)') : 'transparent';
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
    box.querySelector('[data-t="align"]').innerHTML = icon(`align${d.align}`, 24);
    box.querySelector('.cmp-abtn').dataset.bg = d.bg;
    box.querySelectorAll('[data-font]').forEach(b => b.classList.toggle('on', b.dataset.font === d.font));
    box.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('on', b.dataset.color === d.color));
  };
  sync();
  ta.addEventListener('input', sync);
  box.querySelector('input[type=range]').addEventListener('input', e => { d.size = Number(e.target.value); sync(); });
  box.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) { if (e.target === box || e.target === area) done(); return; }
    if (b.dataset.font) { d.font = b.dataset.font; S.lastFont = d.font; }
    else if (b.dataset.color) d.color = b.dataset.color;
    else if (b.dataset.t === 'align') d.align = { center: 'left', left: 'right', right: 'center' }[d.align];
    else if (b.dataset.t === 'bg') d.bg = (d.bg + 1) % 3;
    else if (b.dataset.t === 'done') return done();
    sync();
    ta.focus();
  });
  const fitKeyboard = () => {
    if (!window.visualViewport) return;
    const kb = Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop);
    box.style.setProperty('--kb', `${kb}px`);
  };
  if (window.visualViewport) { S.vv = fitKeyboard; visualViewport.addEventListener('resize', fitKeyboard); }
  setTimeout(() => ta.focus(), 60);
  function done() {
    if (S.vv) { visualViewport.removeEventListener('resize', S.vv); S.vv = null; }
    box.remove();
    S.mode = 'edit';
    S.el.dataset.mode = 'edit';
    setTimeout(layout, 300);
    const text = d.text.replace(/\s+$/g, '');
    if (item) {
      item.el.style.visibility = '';
      if (!text.trim()) removeItem(item);
      else { item.d = { ...d, text }; paintItem(item); place(item); }
    } else if (text.trim()) {
      mount({ type: 'text', d: { ...d, text }, x: K.W / 2, y: K.H * 0.42, s: 1, r: 0 });
    }
  }
}

/* ═════════════ Stickers tray ═════════════ */
function specials() {
  const I = S.info;
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const list = [
    { kind: 'pill', icon: '👟', label: `${fmt(I.steps)} ${t('unit.steps')}`, style: 0 },
    { kind: 'goal', label: `${Math.min(999, Math.round((I.steps / I.goal) * 100))}%`, sub: t('st.k.goalSub'), value: I.steps / I.goal, style: 0 },
    I.streak > 0 ? { kind: 'pill', icon: '🔥', label: tn('st.k.streak', I.streak), style: 3 } : null,
    { kind: 'pill', icon: '🏆', label: t('st.k.rank', { rank: I.rank, M: I.M }), style: 1 },
    I.live ? { kind: 'pill', icon: '📅', label: t('st.k.day', { n: I.day, N: I.N }), style: 2 } : null,
    I.place ? { kind: 'pill', icon: '📍', label: I.place, style: 0 } : null,
    { kind: 'time', icon: '', label: time, style: 2 },
    { kind: 'pill', icon: '💪', label: 'TEAM 8', style: 1 },
  ];
  return list.filter(Boolean);
}

function openTray() {
  S.mode = 'tray';
  const tray = document.createElement('div');
  tray.className = 'cmp-tray';
  tray.innerHTML = `<div class="cmp-tray-bg" data-tray="close"></div><div class="cmp-tray-card" role="dialog" aria-label="${esc(t('st.c.stickers'))}">
    <div class="cmp-tray-handle"></div>
    <div class="cmp-tray-body">
      <div class="cmp-specials"></div>
      <div class="cmp-emojis">${EMOJIS.map(e => `<button data-emoji="${e}">${e}</button>`).join('')}</div>
    </div></div>`;
  const sp = tray.querySelector('.cmp-specials');
  specials().forEach(d => {
    const b = document.createElement('button');
    b.className = 'cmp-special';
    b.setAttribute('aria-label', d.label);
    const c = K.renderSticker(d, 0.3 * S.dpr);
    c.style.width = `${c.width / S.dpr}px`;
    b.appendChild(c);
    b.addEventListener('click', () => { addSticker({ ...d }); closeTray(); });
    sp.appendChild(b);
  });
  const mention = document.createElement('button');
  mention.className = 'cmp-special mention';
  mention.innerHTML = `<span>@ ${t('st.k.mention')}</span>`;
  mention.addEventListener('click', () => {
    tray.querySelector('.cmp-tray-body').innerHTML = `<p class="cmp-tray-h">${t('st.k.mentionWho')}</p><div class="cmp-people">${S.info.members.filter(m => m.id !== S.info.me.id)
      .map(m => `<button data-mention="${esc(m.id)}">${m.avatarHtml}<span>${esc(m.first)}</span></button>`).join('')}</div>`;
  });
  sp.appendChild(mention);
  tray.addEventListener('click', e => {
    const b = e.target.closest('[data-emoji], [data-mention], [data-tray]');
    if (!b) return;
    if (b.dataset.emoji) addSticker({ kind: 'emoji', text: b.dataset.emoji });
    else if (b.dataset.mention) {
      const m = S.info.members.find(x => x.id === b.dataset.mention);
      addSticker({ kind: 'mention', icon: '', label: `@${m.first.toUpperCase()}`, mention: m.id, style: 0 });
    }
    closeTray();
  });
  S.el.appendChild(tray);
  requestAnimationFrame(() => tray.classList.add('in'));
  function closeTray() {
    tray.classList.remove('in');
    setTimeout(() => tray.remove(), 250);
    if (S) S.mode = 'edit';
  }
}

/* ═════════════ Drawing ═════════════ */
let committed = null;
function redrawStrokes() {
  if (!S) return;
  const c = S.drawC, x = c.getContext('2d'), k = S.sc * S.dpr;
  committed = document.createElement('canvas');
  committed.width = c.width; committed.height = c.height;
  const cx = committed.getContext('2d');
  S.strokes.forEach(s => K.drawStroke(cx, s, k));
  x.clearRect(0, 0, c.width, c.height);
  x.drawImage(committed, 0, 0);
}

function openDraw() {
  S.mode = 'draw';
  S.el.dataset.mode = 'draw';
  const box = document.createElement('div');
  box.className = 'cmp-drawui';
  const tools = { pen: 'edit', marker: 'marker', neon: 'sparkle', eraser: 'eraser' };
  const paint = () => {
    box.innerHTML = `
      <div class="cmp-text-top">
        <button class="cmp-icon" data-d="undo" aria-label="${esc(t('st.c.undo'))}" ${S.strokes.length ? '' : 'disabled'}>${icon('undo', 24)}</button>
        <span class="cmp-sp"></span>
        ${K.BRUSHES.map(b => `<button class="cmp-icon tool ${S.brush.tool === b ? 'on' : ''}" data-tool="${b}" aria-label="${esc(t(`st.c.brush.${b}`))}">${icon(tools[b], 24)}</button>`).join('')}
        <span class="cmp-sp"></span>
        <button class="cmp-done" data-d="done">${t('st.c.done')}</button>
      </div>
      <div class="cmp-size"><input type="range" min="4" max="48" value="${S.brush.size}" aria-label="${esc(t('st.c.size'))}"></div>
      <div class="cmp-text-bottom"><div class="cmp-colors">${K.COLORS.map(c => `<button data-color="${c}" class="${S.brush.color === c ? 'on' : ''}" style="--c:${c}" aria-label="${c}"></button>`).join('')}</div></div>`;
    box.querySelector('input').addEventListener('input', e => { S.brush.size = Number(e.target.value); });
  };
  paint();
  box.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tool) S.brush.tool = b.dataset.tool;
    else if (b.dataset.color) { S.brush.color = b.dataset.color; if (S.brush.tool === 'eraser') S.brush.tool = 'pen'; }
    else if (b.dataset.d === 'undo') { S.strokes.pop(); redrawStrokes(); }
    else if (b.dataset.d === 'done') { box.remove(); S.mode = 'edit'; S.el.dataset.mode = 'edit'; S.drawC.classList.remove('live'); return; }
    paint();
  });
  S.el.appendChild(box);
  S.drawC.classList.add('live');
  S.drawBox = { paint };
}

/* ═════════════ Filters ═════════════ */
function flashFilter() {
  const f = S.el.querySelector('.cmp-fname');
  f.textContent = K.filterName(K.FILTERS[S.filter]);
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
}
function setFilter(i) {
  S.filter = (i + K.FILTERS.length) % K.FILTERS.length;
  requestDraw();
  flashFilter();
  const strip = S.el.querySelector('.cmp-filters');
  if (strip) strip.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === S.filter));
  if (navigator.vibrate) navigator.vibrate(8);
}
function toggleFilters() {
  const strip = S.el.querySelector('.cmp-filters');
  if (!strip) return;
  strip.hidden = !strip.hidden;
  if (strip.hidden || strip.children.length) return;
  // thumbnails: one small renderer, copied into 2D canvases
  const tw = 72, th = 128;
  const glc = document.createElement('canvas');
  glc.width = tw; glc.height = th;
  const r = new K.Renderer(glc, { preserve: true });
  r.source(S.media.el);
  K.FILTERS.forEach((f, k) => {
    r.draw({ tf: S.tf, filter: k, bg: S.bg, mw: S.media.w, mh: S.media.h });
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    c.getContext('2d').drawImage(glc, 0, 0);
    const b = document.createElement('button');
    b.className = k === S.filter ? 'on' : '';
    b.append(c);
    b.insertAdjacentHTML('beforeend', `<span>${esc(K.filterName(f))}</span>`);
    b.addEventListener('click', () => setFilter(k));
    strip.appendChild(b);
  });
  r.dispose();
}

/* ═════════════ Gestures on the stage ═════════════ */
function bind() {
  addEventListener('resize', layout);
  const el = S.el;
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-c]');
    if (!b || !S || S.busy) return;
    const c = b.dataset.c;
    if (c === 'close') askClose();
    else if (c === 'retake') { if (!dirty() || S.items.length + S.strokes.length === 0 || confirm(t('st.c.discard'))) retake(); }
    else if (c === 'gallery') el.querySelector('[data-file]').click();
    else if (c === 'flip') { S.facing = S.facing === 'user' ? 'environment' : 'user'; stopCamera(); startCamera(); }
    else if (c === 'aa') startText();
    else if (c === 'text') openText(null);
    else if (c === 'stickers') openTray();
    else if (c === 'draw') openDraw();
    else if (c === 'filters') toggleFilters();
    else if (c === 'grad') { S.grad = (S.grad + 1) % K.GRADIENTS.length; S.bg = K.GRADIENTS[S.grad]; requestDraw(); b.style.setProperty('--g1', `rgb(${S.bg[0]})`); b.style.setProperty('--g2', `rgb(${S.bg[1]})`); }
    else if (c === 'mute') { S.media.muted = !S.media.muted; S.media.el.muted = S.media.muted; b.innerHTML = icon(S.media.muted ? 'muted' : 'sound', 24); if (!S.media.muted) S.media.el.play().catch(() => {}); }
    else if (c === 'save') finish(true);
    else if (c === 'post') finish(false);
  });
  el.querySelector('[data-file]').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; pickFile(f); });
  el.addEventListener('input', e => {
    if (!e.target.matches('[data-trim]')) return;
    const a = Number(e.target.value);
    S.media.trim = [a, Math.min(S.media.du, a + K.MAX_VIDEO_SECONDS)];
    S.media.el.currentTime = a;
    trimLabel();
  });

  // shutter: tap = photo, hold = video
  let holdT = 0, held = false;
  el.addEventListener('pointerdown', e => {
    if (!e.target.closest('[data-c="shutter"]') || S.mode !== 'camera') return;
    held = false;
    holdT = setTimeout(() => { held = startRecording(); }, HOLD_MS);
  });
  const release = e => {
    if (!S || S.mode !== 'camera' || !holdT) return;
    clearTimeout(holdT); holdT = 0;
    if (held) stopRecording();
    else if (e.type === 'pointerup' && e.target.closest('[data-c="shutter"]')) snapPhoto();
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);

  // editing gestures: drag / pinch / rotate items or the media; swipe = filter; tap = text
  const P = new Map();
  let G = null;
  const stage = S.stage;
  const pt = e => { const r = G ? G.rect : stage.getBoundingClientRect(); return { x: (e.clientX - r.left) / S.sc, y: (e.clientY - r.top) / S.sc }; };
  const two = () => { const [a, b] = [...P.values()]; return { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x), c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; };
  const guides = (v, h) => { stage.querySelector('.cmp-guide.v').classList.toggle('on', v); stage.querySelector('.cmp-guide.h').classList.toggle('on', h); };
  // A tap opens the text editor on pointerup, but its click comes a moment later and lands on the editor itself,
  // which read it as "tap outside = done" and closed it at once (the screen just blinked). Eat that one click.
  const tapText = item => {
    const eat = e => { e.stopPropagation(); e.preventDefault(); };
    el.addEventListener('click', eat, { capture: true, once: true });
    setTimeout(() => el.removeEventListener('click', eat, true), 400);
    openText(item);
  };

  stage.addEventListener('pointerdown', e => {
    if (!S || S.mode !== 'edit' || e.button > 0) return;
    if (!G) G = { rect: stage.getBoundingClientRect() };
    P.set(e.pointerId, pt(e));
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (P.size === 1) {
      const itEl = e.target.closest('.cmp-item');
      const it = itEl && itemOf(itEl);
      Object.assign(G, { it, p0: pt(e), t0: performance.now(), moved: false, pinch: null, base: it ? { x: it.x, y: it.y } : { x: S.tf.x, y: S.tf.y } });
      if (it) { toFront(it); it.el.classList.remove('pop'); }
    } else if (P.size === 2) {
      const g = two();
      const target = G.it || S.tf;
      G.pinch = { ...g, s: target.s, r: target.r, x: target.x, y: target.y };
      G.moved = true;
    }
  });
  stage.addEventListener('pointermove', e => {
    if (!G || !P.has(e.pointerId)) return;
    P.set(e.pointerId, pt(e));
    if (G.pinch && P.size >= 2) {
      const g = two(), p = G.pinch;
      const target = G.it || (S.media.kind !== 'none' ? S.tf : null);
      if (!target) return;
      target.s = Math.max(0.15, Math.min(G.it ? 8 : 12 * (K.W / S.media.w), (p.s * g.d) / p.d));
      target.r = p.r + (g.a - p.a);
      target.x = p.x + (g.c.x - p.c.x);
      target.y = p.y + (g.c.y - p.c.y);
      if (G.it) place(G.it); else requestDraw();
      return;
    }
    if (P.size !== 1) return;
    const q = P.get(e.pointerId);
    const dx = q.x - G.p0.x, dy = q.y - G.p0.y;
    if (!G.moved && Math.hypot(dx, dy) * S.sc > 6) { G.moved = true; if (G.it) el.classList.add('dragging'); }
    if (!G.moved || !G.it) return;
    let x = G.base.x + dx, y = G.base.y + dy;
    const sv = Math.abs(x - K.W / 2) < 16, sh = Math.abs(y - K.H / 2) < 16;
    if (sv) x = K.W / 2;
    if (sh) y = K.H / 2;
    guides(sv, sh);
    G.it.x = x; G.it.y = y;
    const overTrash = q.y > K.H * 0.86 && Math.abs(q.x - K.W / 2) < 170;
    if (overTrash !== G.trash) { G.trash = overTrash; el.classList.toggle('trash-hot', overTrash); if (overTrash && navigator.vibrate) navigator.vibrate(10); }
    G.it.el.classList.toggle('doomed', overTrash);
    place(G.it);
  });
  const up = e => {
    if (!G || !P.has(e.pointerId)) return;
    const q = P.get(e.pointerId);
    P.delete(e.pointerId);
    if (P.size === 1 && G.pinch) { // one finger left: keep dragging from here
      const [rest] = [...P.values()];
      G.pinch = null;
      G.p0 = rest;
      G.base = G.it ? { x: G.it.x, y: G.it.y } : { x: S.tf.x, y: S.tf.y };
      return;
    }
    if (P.size) return;
    const g = G;
    G = null;
    guides(false, false);
    el.classList.remove('dragging', 'trash-hot');
    if (g.it) {
      if (g.trash) { removeItem(g.it); if (navigator.vibrate) navigator.vibrate(20); return; }
      if (!g.moved && performance.now() - g.t0 < 350) {
        if (g.it.type === 'text') return tapText(g.it);
        if (g.it.d.kind !== 'emoji') { g.it.d = { ...g.it.d, style: ((g.it.d.style || 0) + 1) % K.STICKER_STYLES }; paintItem(g.it); place(g.it); }
        return;
      }
      if (Math.abs(g.it.s / g.it.rs - 1) > 0.12) { paintItem(g.it); place(g.it); }
      return;
    }
    const dx = q.x - g.p0.x, dy = q.y - g.p0.y;
    if (!g.moved && performance.now() - g.t0 < 350) return tapText(null);
    if (!g.pinch && S.media.kind !== 'none' && Math.abs(dx) * S.sc > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) setFilter(S.filter + (dx < 0 ? 1 : -1));
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);

  // drawing
  let stroke = null;
  const dc = S.drawC;
  dc.addEventListener('pointerdown', e => {
    if (S.mode !== 'draw') return;
    const r = stage.getBoundingClientRect();
    stroke = { tool: S.brush.tool, color: S.brush.color, size: S.brush.size, pts: [(e.clientX - r.left) / S.sc, (e.clientY - r.top) / S.sc], r };
    try { dc.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    paintStroke();
  });
  dc.addEventListener('pointermove', e => {
    if (!stroke) return;
    const x = (e.clientX - stroke.r.left) / S.sc, y = (e.clientY - stroke.r.top) / S.sc;
    const n = stroke.pts.length;
    if (Math.hypot(x - stroke.pts[n - 2], y - stroke.pts[n - 1]) < 3) return;
    stroke.pts.push(x, y);
    paintStroke();
  });
  const endStroke = () => {
    if (!stroke) return;
    const { r, ...s } = stroke;
    S.strokes.push(s);
    stroke = null;
    redrawStrokes();
    if (S.drawBox) S.drawBox.paint();
  };
  dc.addEventListener('pointerup', endStroke);
  dc.addEventListener('pointercancel', endStroke);
  function paintStroke() {
    const x = dc.getContext('2d');
    x.clearRect(0, 0, dc.width, dc.height);
    if (committed) x.drawImage(committed, 0, 0);
    K.drawStroke(x, stroke, S.sc * S.dpr);
  }
}

function retake() {
  if (S.media.kind === 'video') { S.media.el.pause(); S.media.el.remove(); URL.revokeObjectURL(S.media.url); }
  S.items.forEach(it => it.el.remove());
  S.items = []; S.strokes = []; S.filter = 0;
  redrawStrokes();
  S.media = { kind: 'none', el: null, w: 0, h: 0 };
  cancelAnimationFrame(S.raf);
  startCamera();
}

/* ═════════════ Finish: post or save ═════════════ */
const altText = () => S.items.map(it => (it.type === 'text' ? it.d.text : it.d.kind === 'emoji' ? it.d.text : `${it.d.icon || ''} ${it.d.label}`.trim())).join(' · ').slice(0, 300);
const mentions = () => [...new Set(S.items.map(it => it.d && it.d.mention).filter(Boolean))];

async function finish(save) {
  if (S.busy) return;
  const video = S.media.kind === 'video';
  // the AudioContext must be created inside the tap on iOS
  const AC = window.AudioContext || window.webkitAudioContext;
  const audio = video && !S.media.muted && AC ? new AC() : null;
  S.busy = true;
  const ctl = new AbortController();
  const busy = document.createElement('div');
  busy.className = 'cmp-busy';
  busy.innerHTML = `<div class="cmp-busy-card"><div class="cmp-busy-prev"></div><div class="cmp-busy-ring" style="--p:0%"><b>0%</b></div>
    <p>${t(video ? 'st.c.preparingVideo' : 'st.c.preparing')}</p><small>${video ? t('st.c.keepOpen') : ''}</small>
    ${video ? `<button class="cmp-pill light" data-busy="cancel">${t('st.cancel')}</button>` : ''}</div>`;
  busy.addEventListener('click', e => { if (e.target.closest('[data-busy="cancel"]')) ctl.abort(); });
  S.el.appendChild(busy);
  const setP = p => { const r = busy.querySelector('.cmp-busy-ring'); r.style.setProperty('--p', `${Math.round(p * 100)}%`); r.querySelector('b').textContent = `${Math.round(p * 100)}%`; };
  const st = { media: S.media, tf: S.tf, filter: S.filter, bg: S.bg, items: S.items, strokes: S.strokes };
  if (video) S.media.el.pause();
  try {
    let blob, meta;
    const base = { x: altText(), mn: mentions(), bg: K.hexOf(S.bg[0]) };
    if (video) {
      const r = await K.exportVideo(st, { audio, signal: ctl.signal, onProgress: setP, preview: c => busy.querySelector('.cmp-busy-prev').appendChild(c) });
      blob = r.blob;
      meta = { kind: 'video', w: 720, h: 1280, du: r.du, ...base };
    } else {
      blob = await K.exportImage(st);
      meta = { kind: 'image', w: K.W, h: K.H, ...base };
    }
    if (save) {
      await saveFile(blob);
      busy.remove();
      S.busy = false;
      if (video) S.media.el.play().catch(() => {});
      return;
    }
    const onPost = S.onPost;
    close();
    onPost({ blob, meta });
  } catch (e) {
    if (!S) return;
    busy.remove();
    S.busy = false;
    if (video) S.media.el.play().catch(() => {});
    if (e && e.code === 'hidden') toast(t('st.c.keepOpen'), { type: 'warn', duration: 6000 });
    else if (!(e && e.name === 'AbortError')) toast(t('st.c.exportFail'), { type: 'warn', duration: 5000 });
  } finally {
    if (audio) audio.close().catch(() => {});
  }
}

async function saveFile(blob) {
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('webm') ? 'webm' : 'jpg';
  const file = new File([blob], `team8-story-${Date.now()}.${ext}`, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(t('st.c.saved'), { type: 'good' });
}
