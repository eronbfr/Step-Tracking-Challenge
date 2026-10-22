// Small UI toolkit: formatting, icons, avatars, sheets, toasts, confetti.
import { parseISO } from './metrics.js';
import { t, locale } from './i18n.js';
import { avatarImg } from './avatars.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Numbers (formatted for the current language) ── */
const NF = new Map();
const nf = (min, max) => {
  const k = `${locale()}|${min}|${max}`;
  if (!NF.has(k)) NF.set(k, new Intl.NumberFormat(locale(), { minimumFractionDigits: min, maximumFractionDigits: max }));
  return NF.get(k);
};
export const fmt = n => nf(0, 0).format(Math.round(Number(n) || 0));
/** Fixed decimals with the local separator: dec(1.5) → "1.5" / "1,5" */
export const dec = (n, d = 1) => nf(d, d).format(Number(n) || 0);
export function compact(n) {
  n = Number(n) || 0;
  const a = Math.abs(n);
  if (a >= 1e6) return `${nf(0, a >= 1e7 ? 1 : 2).format(n / 1e6)}M`;
  if (a >= 1e4) return `${nf(0, a >= 1e5 ? 0 : 1).format(n / 1e3)}K`;
  return fmt(n);
}
export const pct = (x, d = 0) => `${dec(Math.max(0, x) * 100, d)}%`;
export function dist(km, units) {
  const v = units === 'imperial' ? km * 0.621371 : km;
  const u = units === 'imperial' ? 'mi' : 'km';
  return { v, u, text: `${v >= 100 ? fmt(v) : dec(v, 1)} ${u}` };
}
export function duration(min) {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h >= 10 ? `${fmt(h)} h` : `${h} h ${m ? `${m} min` : ''}`.trim();
}

/* ── Dates ── */
export function dateLabel(s, style = 'long') {
  const d = parseISO(s);
  const parts = { d: d.getDate(), mon: t('cal.mon')[d.getMonth()], dow: t('cal.dow')[d.getDay()] };
  if (style === 'short') return t('date.short', parts);
  if (style === 'dow') return `${parts.dow} ${parts.d}`;
  if (style === 'num') return `${parts.d}`;
  return t('date.long', parts);
}
/** Short weekday names, Monday first. */
export const weekdays = () => { const w = t('cal.dow'); return [...w.slice(1), w[0]]; };
export function ago(isoTs) {
  if (!isoTs) return t('ago.never');
  const s = (Date.now() - new Date(isoTs).getTime()) / 1000;
  if (s < 60) return t('ago.now');
  if (s < 3600) return t('ago.min', { n: Math.floor(s / 60) });
  if (s < 86400) return t('ago.h', { n: Math.floor(s / 3600) });
  if (s < 172800) return t('ago.yesterday');
  return t('ago.days', { n: Math.floor(s / 86400) });
}

/* ── Identity ── */
const AV = ['#2a78d6', '#eb6834', '#16a37a', '#c98500', '#d6517f', '#2f8f3a', '#6a5bd6', '#e04646', '#0e9fb5'];
export const avColor = m => AV[(m.idx ?? 0) % AV.length];
export const initials = name => name.split(/\s+/).filter(Boolean).map(w => w[0]).filter((_, i, a) => i === 0 || i === a.length - 1).join('').toUpperCase();
export const flag = cc => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1f1a5 + c.charCodeAt(0))) : '');
// Windows can't draw flag emoji (it shows two letters), so detect support once and fall back to a code tag.
let flagSupport;
export function flagsSupported() {
  if (flagSupport !== undefined) return flagSupport;
  flagSupport = true;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 20;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.textBaseline = 'top';
    x.font = '16px sans-serif';
    x.fillText(flag('BR'), 0, 0);
    const d = x.getImageData(0, 0, 20, 20).data;
    flagSupport = false;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40 && (Math.abs(d[i] - d[i + 1]) > 12 || Math.abs(d[i + 1] - d[i + 2]) > 12)) { flagSupport = true; break; }
  } catch { flagSupport = true; }
  return flagSupport;
}
/** A member's picture: their chosen illustrated avatar, or coloured initials. */
export function avatar(m, size = 40, { flagged = true } = {}) {
  const badge = !flagged || !m.country ? '' : flagsSupported() ? `<span class="av-flag">${flag(m.country)}</span>` : `<span class="av-cc">${esc(m.country)}</span>`;
  const pic = avatarImg(m.avatar);
  if (pic) return `<span class="avatar pic" style="--av:${avColor(m)};--s:${size}px" aria-hidden="true">${pic}${badge}</span>`;
  return `<span class="avatar" style="--av:${avColor(m)};--s:${size}px" aria-hidden="true">${esc(initials(m.name))}${badge}</span>`;
}

/* ── Icons (24×24, stroke) ── */
const P = {
  team: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.3.1 4 1.6 4.5 4.3"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.5 20h7M9.5 17h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.5-4.5M4 13a8 8 0 0 0 14.5 4.5"/><path d="M5 3v4h4M19 21v-4h-4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.3-2h5l1.3 2h1.7A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  install: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M6 12v6.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V12"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  heart: '<path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.7-7 10-7 10z"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  gear: '<path d="M10.2 4.8l.4-2.3h2.8l.4 2.3a7.4 7.4 0 0 1 2 .9l1.9-1.4 2 2-1.4 1.9a7.4 7.4 0 0 1 .9 2l2.3.4v2.8l-2.3.4a7.4 7.4 0 0 1-.9 2l1.4 1.9-2 2-1.9-1.4a7.4 7.4 0 0 1-2 .9l-.4 2.3h-2.8l-.4-2.3a7.4 7.4 0 0 1-2-.9l-1.9 1.4-2-2 1.4-1.9a7.4 7.4 0 0 1-.9-2l-2.3-.4v-2.8l2.3-.4a7.4 7.4 0 0 1 .9-2L4.3 6.3l2-2 1.9 1.4a7.4 7.4 0 0 1 2-.9z"/><circle cx="12" cy="12" r="3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5z"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
  table: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M4 14.5h16M10 5v14"/>',
  edit: '<path d="M5 19l1-4L16 5l3 3L9 18z"/>',
  wifi: '<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4-2.4M19 13a10 10 0 0 0-2.6-1.9M2 9.5a15 15 0 0 1 5-3M22 9.5a15 15 0 0 0-8.5-4"/><path d="M12 20h.01"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  muted: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  send: '<path d="M21 3L10 14"/><path d="M21 3l-6.5 18-4.5-7-7-4.5z"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5h9l1-12.5"/><path d="M10 11v5M14 11v5"/>',
  sticker: '<path d="M14.5 20.5H8A4.5 4.5 0 0 1 3.5 16V8A4.5 4.5 0 0 1 8 3.5h8A4.5 4.5 0 0 1 20.5 8v6.5z"/><path d="M14.5 20.5v-3a3 3 0 0 1 3-3h3"/><path d="M9 9.5h.01M15 9.5h.01M8.8 13.6c.9.9 1.9 1.3 3.2 1.3"/>',
  draw: '<path d="M3 17c3-4 5-1 7-3s1-6 4-7 4 2 3 4-4 3-3 6 4 1 6-1"/>',
  sparkle: '<path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8z"/><path d="M18.5 14.5l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z"/>',
  flip: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.3-2h5l1.3 2h1.7A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><path d="M9 12.5a3 3 0 0 1 5.2-2M15 12.5a3 3 0 0 1-5.2 2"/><path d="M14.5 8.8v1.8h-1.8M9.5 16.2v-1.8h1.8"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 15.5l-5-5-9 9"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  alignleft: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  aligncenter: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  alignright: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z"/><path d="M9 12l2 2 4-4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eraser: '<path d="M8.5 19.5L4 15l9.5-9.5a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8z"/><path d="M8.5 19.5H20M9.5 10l5.5 5.5"/>',
  marker: '<path d="M9 15l-4 4h5l1.5-1.5"/><path d="M8.5 13.5L15 4l5 3.5-6.5 9.5z"/>',
  calc: '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01"/>',
};
export const icon = (name, size = 22, cls = '') =>
  `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

/* ── Progress ring ── */
export function ring(p, { size = 64, stroke = 7, cls = '', label = '' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, p || 0));
  return `<svg class="ring ${cls} ${p >= 1 ? 'done' : ''}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label || pct(p))}">
    <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" fill="none"/>
    <circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" fill="none" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - v)).toFixed(2)}" style="--c:${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}

/* ── Toasts ── */
export function toast(msg, { type = 'info', duration = 3200, action = null } = {}) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-btn">${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').addEventListener('click', () => { action.run(); el.remove(); });
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  if (duration) setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, duration);
  return el;
}

/* ── Page scroll lock, shared by every overlay (sheet, story viewer, composer) so closing one keeps the others locked ── */
let scrollLocks = 0;
export function lockScroll() { if (++scrollLocks === 1) document.body.classList.add('no-scroll'); }
export function unlockScroll() { if (scrollLocks && --scrollLocks === 0) document.body.classList.remove('no-scroll'); }

/* ── Bottom sheet ── */
let openSheetEl = null;
export function openSheet(html, { onClose, cls = '', label = t('common.dialog') } = {}) {
  closeSheet(true);
  const wrap = document.createElement('div');
  wrap.className = `sheet-wrap ${cls}`;
  wrap.innerHTML = `<div class="sheet-backdrop" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">
      <div class="sheet-handle" aria-hidden="true"></div>
      <button class="icon-btn sheet-close" data-close aria-label="${esc(t('common.close'))}">${icon('close', 20)}</button>
      <div class="sheet-body">${html}</div>
    </div>`;
  document.body.appendChild(wrap);
  lockScroll();
  wrap._onClose = onClose;
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
  openSheetEl = wrap;
  requestAnimationFrame(() => wrap.classList.add('in'));
  enableSwipeDown(wrap);
  return wrap.querySelector('.sheet-body');
}
export function closeSheet(immediate = false) {
  const wrap = openSheetEl;
  if (!wrap) return;
  openSheetEl = null;
  unlockScroll();
  const done = () => { wrap.remove(); wrap._onClose && wrap._onClose(); };
  if (immediate) return done();
  wrap.classList.remove('in');
  setTimeout(done, 260);
}
export const sheetOpen = () => !!openSheetEl;
export const sheetBody = () => openSheetEl && openSheetEl.querySelector('.sheet-body');
function enableSwipeDown(wrap) {
  const sheet = wrap.querySelector('.sheet');
  const handle = wrap.querySelector('.sheet-handle');
  let y0 = null, dy = 0;
  handle.addEventListener('pointerdown', e => { y0 = e.clientY; dy = 0; handle.setPointerCapture(e.pointerId); sheet.style.transition = 'none'; });
  handle.addEventListener('pointermove', e => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); sheet.style.transform = `translateY(${dy}px)`; });
  const end = () => { if (y0 == null) return; sheet.style.transition = ''; sheet.style.transform = ''; if (dy > 90) closeSheet(); y0 = null; };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && openSheetEl) closeSheet(); });

/* ── Count-up animation for big numbers ── */
export function countUp(root = document) {
  if (reducedMotion()) return;
  $$('[data-count]', root).forEach(el => {
    const target = Number(el.dataset.count) || 0;
    if (target < 10) return;
    const formatter = el.dataset.fmt === 'compact' ? compact : fmt;
    const t0 = performance.now(), dur = 900;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3;
      el.textContent = formatter(target * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/* ── Confetti 🎉 ── */
export function confetti({ count = 140 } = {}) {
  if (reducedMotion()) return;
  const cv = document.createElement('canvas');
  cv.className = 'confetti';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#2a78d6', '#eb6834', '#16c784', '#ffc53d', '#d6517f', '#7c5cff'];
  const parts = Array.from({ length: count }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 13, vy: -Math.random() * 13 - 4,
    s: 5 + Math.random() * 6, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  const frame = now => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts.forEach(p => {
      p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66); ctx.restore();
    });
    if (now - t0 < 2600) requestAnimationFrame(frame); else cv.remove();
  };
  requestAnimationFrame(frame);
  if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}
