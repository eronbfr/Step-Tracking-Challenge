// Story media kit: WebGL filters, text / sticker / drawing layers and export (photo → JPEG, video → MediaRecorder).
// Everything is laid out on a 1080 × 1920 story frame; layers are re-drawn at the export size so text stays crisp.
// Loaded on demand by the story composer (and by demo mode to draw its sample stories).
import { t } from './i18n.js';

export const W = 1080, H = 1920;
export const MAX_VIDEO_SECONDS = 15;
const VIDEO_W = 720, VIDEO_H = 1280;
const PHOTO_MAX_BYTES = 1.8 * 1024 * 1024;

/* ═════════════ Filters (named after places; swipe through them like on Instagram) ═════════════ */
// b brightness · c contrast · s saturation · w warmth · t/ta tint colour & amount · f faded blacks · v vignette
export const FILTERS = [
  { id: 'normal', p: {} },
  { id: 'Rio', p: { c: 1.08, s: 1.38, w: 0.035, b: 0.02, v: 0.22 }, css: 'contrast(1.08) saturate(1.38) brightness(1.02)' },
  { id: 'CDMX', p: { c: 1.1, s: 1.2, w: 0.08, t: [1, 0.9, 0.78], ta: 0.28, v: 0.35 }, css: 'contrast(1.1) saturate(1.2) sepia(0.18)' },
  { id: 'Bogotá', p: { c: 0.9, s: 0.82, f: 0.38, w: 0.05, t: [1, 0.94, 0.86], ta: 0.32, v: 0.28, b: 0.02 }, css: 'contrast(0.9) saturate(0.82) sepia(0.28) brightness(1.05)' },
  { id: 'Montevideo', p: { c: 1.05, s: 0.95, w: -0.07, b: 0.03, t: [0.88, 1, 1.1], ta: 0.3, v: 0.18 }, css: 'contrast(1.05) saturate(0.95) hue-rotate(-8deg) brightness(1.04)' },
  { id: 'São Paulo', p: { c: 1.32, s: 0, b: -0.02, v: 0.42 }, css: 'grayscale(1) contrast(1.32)' },
  { id: 'Cusco', p: { c: 1.15, s: 1.18, w: 0.12, t: [1.06, 0.86, 0.94], ta: 0.26, v: 0.45 }, css: 'contrast(1.15) saturate(1.18) sepia(0.2) hue-rotate(-10deg)' },
  { id: 'Havana', p: { c: 0.95, s: 1.28, w: 0.03, f: 0.18, t: [1.1, 0.88, 1.04], ta: 0.34, b: 0.03 }, css: 'saturate(1.28) contrast(0.95) brightness(1.05) hue-rotate(-12deg)' },
  { id: 'Patagonia', p: { c: 1.08, s: 0.78, w: -0.1, b: 0.04, f: 0.1, v: 0.15 }, css: 'saturate(0.78) contrast(1.08) brightness(1.05) hue-rotate(10deg)' },
  { id: 'moon', p: { c: 0.95, s: 0, b: 0.05, f: 0.32, v: 0.3 }, css: 'grayscale(1) contrast(0.95) brightness(1.08)' },
];
export const filterName = f => (f.id === 'normal' ? t('st.filter.normal') : f.id === 'moon' ? t('st.filter.moon') : f.id);

export const GRADIENTS = [
  [[22, 80, 208], [18, 201, 144]], [[255, 122, 24], [255, 61, 119]], [[124, 58, 237], [37, 99, 235]],
  [[17, 24, 39], [55, 65, 81]], [[236, 72, 153], [250, 204, 21]], [[6, 95, 70], [16, 185, 129]], [[30, 27, 75], [190, 24, 93]],
];
export const COLORS = ['#ffffff', '#000000', '#1650d0', '#12c990', '#ffd43b', '#ff922b', '#ff3d77', '#cc5de8', '#74c0fc', '#8ce99a', '#e64980', '#868e96'];

/* ═════════════ WebGL renderer: gradient background · filtered photo/video · overlay ═════════════ */
const VS = `attribute vec2 aPos; attribute vec2 aUv; varying vec2 vUv; varying vec2 vPos;
void main() { vUv = aUv; vPos = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FS_GRAD = `precision mediump float; varying vec2 vPos; uniform vec3 uTop; uniform vec3 uBot;
void main() { gl_FragColor = vec4(mix(uTop, uBot, vPos.y), 1.0); }`;
const FS_MEDIA = `precision mediump float; varying vec2 vUv; varying vec2 vPos; uniform sampler2D uTex;
uniform float uB; uniform float uC; uniform float uS; uniform float uW; uniform float uF; uniform float uV; uniform float uTa; uniform vec3 uT;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  c = (c - 0.5) * uC + 0.5 + uB;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uS);
  c += vec3(uW, uW * 0.25, -uW);
  c = mix(c, c * uT, uTa);
  c = mix(c, vec3(0.1) + c * 0.85, uF);
  c *= 1.0 - uV * smoothstep(0.45, 1.05, distance(vPos, vec2(0.5)) * 1.3);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
const FS_OVER = `precision mediump float; varying vec2 vUv; uniform sampler2D uTex; void main() { gl_FragColor = texture2D(uTex, vUv); }`;

function shader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = name => gl.getUniformLocation(p, name);
  return { p, aPos: gl.getAttribLocation(p, 'aPos'), aUv: gl.getAttribLocation(p, 'aUv'), u };
}
function texture(gl) {
  const tx = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tx);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tx;
}
const FULL = new Float32Array([-1, 1, 0, 0, -1, -1, 0, 1, 1, 1, 1, 0, 1, -1, 1, 1]);
const rgb = c => c.map(v => v / 255);
const cssFilterOK = (() => { try { return 'filter' in CanvasRenderingContext2D.prototype; } catch { return false; } })();

/** Corners of the transformed media in clip space (+ texture coords), as a triangle strip. */
function mediaQuad(tf, mw, mh) {
  const hw = (mw * tf.s) / 2, hh = (mh * tf.s) / 2, cos = Math.cos(tf.r), sin = Math.sin(tf.r);
  const out = [];
  for (const [dx, dy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const lx = dx * hw, ly = dy * hh;
    const px = tf.x + lx * cos - ly * sin, py = tf.y + lx * sin + ly * cos;
    const u = (dx + 1) / 2;
    out.push((px / W) * 2 - 1, 1 - (py / H) * 2, tf.flip ? 1 - u : u, (dy + 1) / 2);
  }
  return new Float32Array(out);
}

export class Renderer {
  constructor(canvas, { preserve = false } = {}) {
    this.canvas = canvas;
    const opts = { alpha: false, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: preserve };
    let gl = null;
    try { gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts); } catch { gl = null; }
    if (gl) {
      try {
        this.pg = program(gl, FS_GRAD); this.pm = program(gl, FS_MEDIA); this.po = program(gl, FS_OVER);
        this.buf = gl.createBuffer(); this.tex = texture(gl); this.otex = texture(gl);
        this.gl = gl;
      } catch (e) { console.warn('story renderer', e); gl = null; }
    }
    if (!gl) this.ctx = canvas.getContext('2d');
  }
  source(el) { this.src = el; this.dirty = true; }
  overlay(c) { this.over = c; this.odirty = true; }

  quad(prog, data) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(prog.aPos);
    gl.vertexAttribPointer(prog.aPos, 2, gl.FLOAT, false, 16, 0);
    if (prog.aUv >= 0) { gl.enableVertexAttribArray(prog.aUv); gl.vertexAttribPointer(prog.aUv, 2, gl.FLOAT, false, 16, 8); }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** st = { tf, filter (index), bg: [[r,g,b], [r,g,b]], mw, mh } */
  draw(st) {
    const { canvas } = this;
    const bg = st.bg || GRADIENTS[0];
    const f = (FILTERS[st.filter] || FILTERS[0]).p;
    const media = this.src && st.mw ? this.src : null;
    if (!this.gl) return this.draw2d(st, bg, media);
    const gl = this.gl;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.pg.p);
    gl.uniform3fv(this.pg.u('uTop'), rgb(bg[0]));
    gl.uniform3fv(this.pg.u('uBot'), rgb(bg[1]));
    this.quad(this.pg, FULL);
    if (media && (!media.readyState || media.readyState >= 2)) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      if (this.dirty || media.tagName === 'VIDEO') {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media); this.dirty = false; } catch { /* frame not ready */ }
      }
      const pm = this.pm;
      gl.useProgram(pm.p);
      gl.uniform1i(pm.u('uTex'), 0);
      gl.uniform1f(pm.u('uB'), f.b || 0); gl.uniform1f(pm.u('uC'), f.c ?? 1); gl.uniform1f(pm.u('uS'), f.s ?? 1);
      gl.uniform1f(pm.u('uW'), f.w || 0); gl.uniform1f(pm.u('uF'), f.f || 0); gl.uniform1f(pm.u('uV'), f.v || 0);
      gl.uniform1f(pm.u('uTa'), f.ta || 0); gl.uniform3fv(pm.u('uT'), f.t || [1, 1, 1]);
      this.quad(pm, mediaQuad(st.tf, st.mw, st.mh));
    }
    if (this.over) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.otex);
      if (this.odirty) {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.over);
        this.odirty = false;
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.po.p);
      gl.uniform1i(this.po.u('uTex'), 0);
      this.quad(this.po, FULL);
    }
  }

  draw2d(st, bg, media) {
    const x = this.ctx, k = this.canvas.width / W;
    const g = x.createLinearGradient(0, 0, 0, this.canvas.height);
    g.addColorStop(0, `rgb(${bg[0]})`); g.addColorStop(1, `rgb(${bg[1]})`);
    x.fillStyle = g;
    x.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (media) {
      x.save();
      x.scale(k, k);
      x.translate(st.tf.x, st.tf.y); x.rotate(st.tf.r); x.scale(st.tf.flip ? -st.tf.s : st.tf.s, st.tf.s);
      if (cssFilterOK) x.filter = (FILTERS[st.filter] || FILTERS[0]).css || 'none';
      try { x.drawImage(media, -st.mw / 2, -st.mh / 2, st.mw, st.mh); } catch { /* frame not ready */ }
      x.restore();
    }
    if (this.over) x.drawImage(this.over, 0, 0, this.canvas.width, this.canvas.height);
  }

  dispose() {
    const ext = this.gl && this.gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  }
}

/** Initial placement: portrait media covers the frame, anything else fits inside it (on a gradient of its own colours). */
export function fitTransform(w, h) {
  const ratio = w / h / (W / H);
  const s = Math.abs(ratio - 1) < 0.28 ? Math.max(W / w, H / h) : Math.min(W / w, H / h);
  return { x: W / 2, y: H / 2, s, r: 0, flip: false };
}

/** Two colours (top / bottom) taken from the media, darkened a little — the frame's background. */
export function bgColors(el) {
  try {
    const c = document.createElement('canvas');
    c.width = 6; c.height = 12;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(el, 0, 0, 6, 12);
    const d = x.getImageData(0, 0, 6, 12).data;
    const avg = (from, to) => {
      const a = [0, 0, 0];
      for (let i = from * 24; i < to * 24; i += 4) { a[0] += d[i]; a[1] += d[i + 1]; a[2] += d[i + 2]; }
      const n = ((to - from) * 24) / 4;
      return a.map(v => Math.round((v / n) * 0.72));
    };
    return [avg(0, 4), avg(8, 12)];
  } catch { return GRADIENTS[3]; }
}
export const hexOf = c => `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;

/* ═════════════ Text ═════════════ */
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
export const TEXT_STYLES = [
  { id: 'classic', font: px => `700 ${px}px ${SANS}`, lh: 1.2 },
  { id: 'modern', font: px => `800 ${px}px "Avenir Next Condensed", "Roboto Condensed", "Arial Narrow", ${SANS}`, upper: true, ls: 0.03, lh: 1.1 },
  { id: 'neon', font: px => `600 ${px}px ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", ${SANS}`, glow: true, lh: 1.22 },
  { id: 'typewriter', font: px => `600 ${px}px "American Typewriter", "Courier New", ui-monospace, monospace`, lh: 1.28 },
  { id: 'strong', font: px => `italic 900 ${px}px "Arial Black", "Helvetica Neue", Impact, ${SANS}`, upper: true, lh: 1.06 },
  { id: 'serif', font: px => `italic 600 ${px}px Didot, "Bodoni 72", Georgia, "Times New Roman", serif`, lh: 1.16 },
];
const light = hex => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 170; };
const mixWhite = (hex, k) => { const n = parseInt(hex.slice(1), 16); return `rgb(${[n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v + (255 - v) * k))})`; };

function wrap(x, text, max) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line.trim() && x.measureText(next.trimEnd()).width > max) { out.push(line.trimEnd()); line = word.trimStart(); } else line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}

function roundRect(x, l, tp, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  x.beginPath();
  x.moveTo(l + r, tp); x.arcTo(l + w, tp, l + w, tp + h, r); x.arcTo(l + w, tp + h, l, tp + h, r);
  x.arcTo(l, tp + h, l, tp, r); x.arcTo(l, tp, l + w, tp, r); x.closePath();
}

/** Text item → canvas. d = { text, font, color, bg (0 none · 1 solid · 2 soft), align, size } in story pixels; k = scale. */
export function renderText(d, k = 1) {
  const st = TEXT_STYLES.find(s => s.id === d.font) || TEXT_STYLES[0];
  const px = Math.max(4, (d.size || 76) * k);
  const c = document.createElement('canvas'), x = c.getContext('2d');
  const font = st.font(px), ls = st.ls ? `${(st.ls * px).toFixed(1)}px` : '0px';
  x.font = font;
  if ('letterSpacing' in x) x.letterSpacing = ls;
  const lines = wrap(x, st.upper ? d.text.toUpperCase() : d.text, 920 * k);
  const widths = lines.map(l => x.measureText(l).width);
  const lh = px * st.lh, padX = px * 0.32, padY = px * 0.16, glow = st.glow ? px * 0.7 : px * 0.2;
  const tw = Math.max(1, ...widths);
  c.width = Math.ceil(tw + 2 * padX + 2 * glow);
  c.height = Math.ceil(lines.length * lh + 2 * padY + 2 * glow);
  x.font = font;
  if ('letterSpacing' in x) x.letterSpacing = ls;
  x.textBaseline = 'middle';
  const color = d.color || '#ffffff';
  const bgFill = d.bg === 1 ? color : d.bg === 2 ? (light(color) ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.72)') : null;
  const ink = d.bg === 1 ? (light(color) ? '#111111' : '#ffffff') : st.glow ? mixWhite(color, 0.55) : color;
  const xOf = (w) => (d.align === 'left' ? glow + padX : d.align === 'right' ? c.width - glow - padX - w : (c.width - w) / 2);
  if (bgFill) {
    x.fillStyle = bgFill;
    lines.forEach((l, i) => {
      if (!l) return;
      roundRect(x, xOf(widths[i]) - padX, glow + padY * 0.4 + i * lh, widths[i] + 2 * padX, lh + padY * 1.2, px * 0.3);
      x.fill();
    });
  }
  const paint = () => lines.forEach((l, i) => x.fillText(l, xOf(widths[i]), glow + padY + i * lh + lh / 2));
  x.fillStyle = ink;
  if (st.glow) {
    x.shadowColor = color; x.shadowBlur = px * 0.5;
    paint(); x.shadowBlur = px * 0.18; paint();
  } else {
    if (!bgFill) { x.shadowColor = 'rgba(0,0,0,0.28)'; x.shadowBlur = px * 0.12; x.shadowOffsetY = px * 0.03; }
    paint();
  }
  return c;
}

/* ═════════════ Stickers ═════════════ */
// kind: emoji | pill (icon + label: steps, streak, rank, day, place, mention, team, time) | goal (progress ring)
export const STICKER_STYLES = 4;
const BRAND = ['#1650d0', '#0aa5e0', '#12c990'];
const WARM = ['#ff7a18', '#ff3d77', '#b026ff'];

function grad(x, w, cols) {
  const g = x.createLinearGradient(0, 0, w, 0);
  cols.forEach((col, i) => g.addColorStop(i / (cols.length - 1), col));
  return g;
}

export function renderSticker(d, k = 1) {
  const c = document.createElement('canvas'), x = c.getContext('2d');
  if (d.kind === 'emoji') {
    const px = 190 * k;
    c.width = c.height = Math.ceil(px * 1.3);
    x.font = `${px}px ${EMOJI}`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(d.text, c.width / 2, c.height / 2 + px * 0.06);
    return c;
  }
  const style = (d.style || 0) % STICKER_STYLES;
  const fills = [() => '#ffffff', w => grad(x, w, BRAND), () => 'rgba(10,14,28,0.5)', w => grad(x, w, WARM)];
  const inks = [w => grad(x, w, d.kind === 'mention' ? WARM : BRAND), () => '#ffffff', () => '#ffffff', () => '#ffffff'];

  if (d.kind === 'goal') {
    const s = 360 * k, pad = 24 * k;
    c.width = Math.ceil(s + pad * 2); c.height = Math.ceil(s * 1.18 + pad * 2);
    x.shadowColor = 'rgba(0,0,0,0.25)'; x.shadowBlur = 18 * k; x.shadowOffsetY = 6 * k;
    x.fillStyle = fills[style](c.width);
    roundRect(x, pad, pad, s, s * 1.18, 56 * k); x.fill();
    x.shadowColor = 'transparent';
    const cx = pad + s / 2, cy = pad + s * 0.47, r = s * 0.31, lw = 30 * k;
    x.lineCap = 'round'; x.lineWidth = lw;
    x.strokeStyle = style === 0 ? '#e6e9f2' : 'rgba(255,255,255,0.28)';
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
    const p = Math.max(0, Math.min(1, d.value || 0));
    x.strokeStyle = p >= 1 ? (style === 0 ? '#0ca30c' : '#8ce99a') : style === 0 ? grad(x, c.width, BRAND) : '#ffffff';
    if (p > 0) { x.beginPath(); x.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); x.stroke(); }
    x.fillStyle = inks[style](c.width);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    let fs = 80 * k;
    do { x.font = `900 ${fs}px ${SANS}`; fs *= 0.92; } while (x.measureText(d.label).width > (r - lw) * 1.7 && fs > 20 * k);
    x.fillText(d.label, cx, cy + 3 * k);
    x.font = `800 ${38 * k}px ${SANS}`;
    x.fillText(d.sub || '', cx, pad + s * 1.02);
    return c;
  }

  const big = d.kind === 'time' ? 1.45 : 1;
  const px = 58 * k * big, h = px * 1.85, padX = px * 0.6, gap = px * 0.3, shadow = 16 * k;
  const iconFont = `${px * 0.95}px ${EMOJI}`, labelFont = `${d.kind === 'time' ? 800 : 850} ${px}px ${SANS}`;
  x.font = iconFont;
  const iw = d.icon ? x.measureText(d.icon).width : 0;
  x.font = labelFont;
  const lw = x.measureText(d.label).width;
  const w = padX * 2 + iw + (d.icon ? gap : 0) + lw;
  c.width = Math.ceil(w + shadow * 2); c.height = Math.ceil(h + shadow * 2);
  x.shadowColor = 'rgba(0,0,0,0.22)'; x.shadowBlur = shadow; x.shadowOffsetY = 5 * k;
  x.fillStyle = fills[style](c.width);
  roundRect(x, shadow, shadow, w, h, h * 0.32); x.fill();
  x.shadowColor = 'transparent';
  x.textBaseline = 'middle';
  let cx = shadow + padX;
  if (d.icon) { x.font = iconFont; x.fillText(d.icon, cx, shadow + h / 2 + px * 0.05); cx += iw + gap; }
  x.font = labelFont;
  x.fillStyle = inks[style](c.width);
  x.fillText(d.label, cx, shadow + h / 2 + px * 0.04);
  return c;
}

export const renderItem = (it, k) => (it.type === 'text' ? renderText(it.d, k) : renderSticker(it.d, k));

/* ═════════════ Drawing ═════════════ */
export const BRUSHES = ['pen', 'marker', 'neon', 'eraser'];

function strokePath(x, pts, k) {
  x.beginPath();
  x.moveTo(pts[0] * k, pts[1] * k);
  if (pts.length <= 2) { x.lineTo(pts[0] * k + 0.01, pts[1] * k); return; }
  for (let i = 2; i < pts.length - 2; i += 2) {
    x.quadraticCurveTo(pts[i] * k, pts[i + 1] * k, ((pts[i] + pts[i + 2]) / 2) * k, ((pts[i + 1] + pts[i + 3]) / 2) * k);
  }
  x.lineTo(pts[pts.length - 2] * k, pts[pts.length - 1] * k);
}

export function drawStroke(x, s, k = 1) {
  const w = s.size * k;
  x.save();
  x.lineCap = 'round'; x.lineJoin = 'round';
  if (s.tool === 'eraser') {
    x.globalCompositeOperation = 'destination-out'; x.strokeStyle = '#000'; x.lineWidth = w * 1.8;
  } else if (s.tool === 'marker') {
    x.globalAlpha = 0.5; x.strokeStyle = s.color; x.lineWidth = w * 2.4; x.lineCap = 'square';
  } else if (s.tool === 'neon') {
    x.shadowColor = s.color; x.shadowBlur = w * 1.8; x.strokeStyle = s.color; x.lineWidth = w;
    strokePath(x, s.pts, k); x.stroke();
    x.shadowBlur = w * 0.6; x.strokeStyle = 'rgba(255,255,255,0.95)'; x.lineWidth = w * 0.42;
  } else {
    x.strokeStyle = s.color; x.lineWidth = w;
  }
  strokePath(x, s.pts, k);
  x.stroke();
  x.restore();
}

/** Drawing + text + stickers flattened onto a transparent canvas of w × h. */
export function composeOverlay(st, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d'), k = w / W;
  if (st.strokes.length) {
    const d = document.createElement('canvas');
    d.width = w; d.height = h;
    const dx = d.getContext('2d');
    st.strokes.forEach(s => drawStroke(dx, s, k));
    x.drawImage(d, 0, 0);
  }
  for (const it of st.items) {
    const img = renderItem(it, k * it.s);
    x.save();
    x.translate(it.x * k, it.y * k);
    x.rotate(it.r);
    x.drawImage(img, -img.width / 2, -img.height / 2);
    x.restore();
  }
  return c;
}

/* ═════════════ Export ═════════════ */
const toBlob = (c, type, q) => new Promise(res => c.toBlob(res, type, q));

/** The finished photo story (1080 × 1920 JPEG, under the relay-friendly size). */
export async function exportImage(st) {
  const glc = document.createElement('canvas');
  glc.width = W; glc.height = H;
  const r = new Renderer(glc, { preserve: true });
  if (st.media.el) r.source(st.media.el);
  r.overlay(composeOverlay(st, W, H));
  r.draw({ tf: st.tf, filter: st.filter, bg: st.bg, mw: st.media.w, mh: st.media.h });
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  out.getContext('2d').drawImage(glc, 0, 0);
  r.dispose();
  let blob = null;
  for (const q of [0.9, 0.82, 0.72, 0.6]) {
    blob = await toBlob(out, 'image/jpeg', q);
    if (blob && blob.size <= PHOTO_MAX_BYTES) break;
  }
  if (!blob) throw new Error('export');
  return blob;
}

const MIMES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
export const recorderMime = () => (typeof MediaRecorder === 'undefined' ? '' : MIMES.find(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || '');
export const canRecordVideo = () => !!recorderMime() && typeof HTMLCanvasElement.prototype.captureStream === 'function';

const waitFor = (el, ev, ms = 8000) => new Promise((res, rej) => {
  const done = () => { clearTimeout(tm); el.removeEventListener(ev, done); res(); };
  const tm = setTimeout(() => { el.removeEventListener(ev, done); rej(new Error(`${ev} timeout`)); }, ms);
  el.addEventListener(ev, done);
});

/**
 * Re-encodes the edited video in real time: filter + drawing + text baked in, trimmed to [a, b], 720 × 1280, ~1.9 Mbit/s.
 * `audio` = an AudioContext created inside the tap (iOS only lets it start there), or null for a silent story.
 * `preview` (optional) receives the canvas being recorded so the progress screen can show it.
 */
export async function exportVideo(st, { audio = null, onProgress = () => {}, preview = null, signal = null } = {}) {
  const mime = recorderMime();
  if (!mime) throw new Error('recorder');
  const [a, b] = st.media.trim;
  const v = document.createElement('video');
  v.playsInline = true; v.preload = 'auto'; v.muted = !audio; v.src = st.media.url;
  v.setAttribute('playsinline', '');
  v.style.cssText = 'position:fixed;left:0;top:0;width:4px;height:4px;opacity:0.01;pointer-events:none';
  document.body.appendChild(v); // some mobile browsers only decode frames of videos that are in the page
  const glc = document.createElement('canvas');
  glc.width = VIDEO_W; glc.height = VIDEO_H;
  const r = new Renderer(glc, { preserve: true });
  let stream = null;
  try {
    if (v.readyState < 2) await waitFor(v, 'loadeddata');
    r.source(v);
    r.overlay(composeOverlay(st, VIDEO_W, VIDEO_H));
    const out = document.createElement('canvas');
    out.width = VIDEO_W; out.height = VIDEO_H;
    const ox = out.getContext('2d');
    if (preview) preview(out);
    const draw = () => { r.draw({ tf: st.tf, filter: st.filter, bg: st.bg, mw: st.media.w, mh: st.media.h }); ox.drawImage(glc, 0, 0); };

    stream = out.captureStream(30);
    if (audio) {
      try {
        const src = audio.createMediaElementSource(v);
        const dest = audio.createMediaStreamDestination();
        src.connect(dest);
        dest.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
        if (audio.state === 'suspended') await audio.resume();
      } catch (e) { console.warn('story audio', e); }
    }
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_800_000, audioBitsPerSecond: 96_000 });
    const chunks = [];
    rec.ondataavailable = e => e.data && e.data.size && chunks.push(e.data);
    const stopped = new Promise(res => { rec.onstop = res; });

    v.currentTime = a;
    await waitFor(v, 'seeked').catch(() => {});
    draw();
    rec.start(250);
    let last = a;
    try {
      await v.play();
      await new Promise((resolve, reject) => {
        // Frames are drawn on requestAnimationFrame (with a timer as backup); requestVideoFrameCallback barely fires
        // for a video that isn't on screen. A hidden page gets no frames at all, so leaving the app stops the export.
        const next = () => { let ran = false; const go = () => { if (!ran) { ran = true; tick(); } }; requestAnimationFrame(go); setTimeout(go, 45); };
        const tick = () => {
          if (signal && signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
          if (document.visibilityState === 'hidden') return reject(Object.assign(new Error('hidden'), { code: 'hidden' }));
          draw();
          last = Math.max(last, v.currentTime);
          onProgress(Math.min(1, (last - a) / Math.max(0.1, b - a)));
          if (v.currentTime >= b - 0.02 || v.ended) return resolve();
          next();
        };
        v.addEventListener('ended', () => { last = Math.max(last, v.currentTime); resolve(); }, { once: true });
        tick();
      });
    } finally {
      v.pause();
      if (rec.state !== 'inactive') rec.stop();
      await stopped;
    }
    onProgress(1);
    return { blob: new Blob(chunks, { type: mime.split(';')[0] }), du: Math.max(0.5, Math.round((Math.min(b, last) - a) * 10) / 10) };
  } finally {
    if (stream) stream.getTracks().forEach(tr => tr.stop());
    r.dispose();
    v.removeAttribute('src'); v.load(); v.remove();
  }
}

/* ═════════════ Demo stories (?demo): drawn here with the same layers people use ═════════════ */
const demoCache = new Map();
const DEMOS = [
  { g: 1, items: [['text', { text: 'Rambla de Montevideo 🌊\n6:30 AM', font: 'classic', color: '#ffffff', bg: 0, size: 84 }, 540, 760, -0.06],
    ['sticker', { kind: 'pill', icon: '👟', label: '8.240 pasos', style: 0 }, 540, 1080, 0.05]], draw: [['#ffd43b', 'neon']] },
  { g: 2, items: [['text', { text: 'Bora, Team 8!', font: 'strong', color: '#ffffff', bg: 0, size: 150 }, 540, 860, -0.08],
    ['sticker', { kind: 'pill', icon: '💪', label: 'TEAM 8', style: 3 }, 540, 1160, 0.06]] },
  { photo: 'assets/map/latam-day.webp', items: [['text', { text: 'Daqui do Brasil pro mundo 🌎', font: 'modern', color: '#ffffff', bg: 2, size: 70 }, 540, 1450, 0],
    ['sticker', { kind: 'pill', icon: '📍', label: 'São Paulo', style: 0 }, 540, 380, -0.04]] },
  { g: 0, items: [['sticker', { kind: 'goal', label: '100%', sub: '¡Meta cumplida!', value: 1, style: 0 }, 540, 820, 0],
    ['text', { text: '10K ✅ antes de las 6 PM', font: 'typewriter', color: '#ffffff', bg: 1, size: 64 }, 540, 1360, 0.03]] },
  { g: 6, items: [['text', { text: 'Caminata nocturna ✨', font: 'neon', color: '#ff3d77', bg: 0, size: 110 }, 540, 700, -0.05],
    ['sticker', { kind: 'emoji', text: '🌙' }, 820, 1250, 0.2]], draw: [['#74c0fc', 'neon'], ['#ffffff', 'pen']] },
  { g: 4, items: [['sticker', { kind: 'emoji', text: '🌮' }, 360, 760, -0.25], ['sticker', { kind: 'emoji', text: '🔥' }, 720, 880, 0.2],
    ['text', { text: '1 taco = 170 kcal\n= 1.700 pasos 😅', font: 'classic', color: '#000000', bg: 1, size: 72 }, 540, 1300, 0]] },
  { g: 5, items: [['sticker', { kind: 'time', icon: '', label: '07:45', style: 2 }, 540, 640, 0],
    ['text', { text: 'Escadas > elevador 🏢', font: 'serif', color: '#ffffff', bg: 0, size: 96 }, 540, 1080, -0.03]] },
];

function squiggle(n, color, tool) {
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push(160 + i * 19, 1560 + Math.sin(i / 3 + n) * 60 + n * 70);
  return { tool, color, size: 16, pts };
}

export function demoStoryUrl(story) {
  if (demoCache.has(story.id)) return demoCache.get(story.id);
  const p = (async () => {
    const def = DEMOS[story.demo % DEMOS.length];
    const st = { media: { el: null, w: 0, h: 0 }, tf: { x: W / 2, y: H / 2, s: 1, r: 0, flip: false }, filter: 0, bg: GRADIENTS[def.g || 0], strokes: [], items: [] };
    if (def.photo) {
      const img = new Image();
      img.src = def.photo;
      await img.decode();
      st.media = { el: img, w: img.naturalWidth, h: img.naturalHeight };
      st.tf = { ...fitTransform(img.naturalWidth, img.naturalHeight), s: Math.max(W / img.naturalWidth, H / img.naturalHeight) };
      st.filter = 1;
    }
    st.items = def.items.map(([type, d, x, y, r]) => ({ type, d, x, y, r, s: 1 }));
    st.strokes = (def.draw || []).map(([color, tool], n) => squiggle(n, color, tool));
    return URL.createObjectURL(await exportImage(st));
  })();
  demoCache.set(story.id, p);
  return p;
}
