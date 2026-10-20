// Backend client (Google Apps Script) with an offline outbox and a self-contained demo mode.
import { CONFIG } from './config.js';
import { iso, datesBetween, dow } from './metrics.js';
import { t, lang } from './i18n.js';
import { isAvatar } from './avatars.js';

const params = new URLSearchParams(location.search);
export const DEMO = !CONFIG.API_URL || params.has('demo');
const AS_OF = DEMO && /^\d{4}-\d{2}-\d{2}$/.test(params.get('asOf') || '') ? params.get('asOf') : null;

export const today = () => AS_OF || iso(new Date());

export class ApiError extends Error {
  constructor(message, network = false, code = '') { super(message); this.network = network; this.code = code; }
}

export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const KEY = { data: 't8:data', outbox: 't8:outbox', demo: 't8:demo', demoPins: 't8:demo-pins', demoSync: 't8:demo-sync', demoAvatars: 't8:demo-avatars' };

async function request(payload, method = 'POST') {
  payload = { ...payload, lang: lang() }; // the server answers errors in the same language
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = method === 'GET'
      ? await fetch(`${CONFIG.API_URL}?${new URLSearchParams({ ...payload, _: Date.now() })}`, { signal: ctrl.signal, cache: 'no-store' })
      : await fetch(CONFIG.API_URL, {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // "simple" request → no CORS preflight
          signal: ctrl.signal,
        });
    let json;
    try { json = await res.json(); } catch { throw new ApiError(t('err.badResponse')); }
    if (!json.ok) throw new ApiError(json.error || t('err.requestFailed'), false, json.code || '');
    return json;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e.name === 'AbortError') throw new ApiError(t('err.timeout'), true);
    throw new ApiError(t('err.offline'), true);
  } finally {
    clearTimeout(timer);
  }
}

/* ── Public API ── */
export function cachedData() {
  const c = store.get(KEY.data);
  return c && c.source === (DEMO ? 'demo' : CONFIG.API_URL) ? applyOutbox(c.data) : null;
}

export async function fetchData() {
  const data = DEMO ? demoData() : await request({ action: 'data' }, 'GET');
  store.set(KEY.data, { source: DEMO ? 'demo' : CONFIG.API_URL, data });
  return applyOutbox(data);
}

export async function claim(id, pin) {
  if (DEMO) return demoClaim(id, pin);
  return request({ action: 'claim', m: id, pin, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
}

/** Saves steps; when offline the entry is queued and replayed later. Returns { queued } */
export async function logSteps(entry) {
  if (DEMO) { demoLog(entry); return { ok: true, queued: false }; }
  try {
    await request({ action: 'log', m: entry.id, t: entry.token, date: entry.date, steps: entry.steps, mode: 'set' });
    dropFromOutbox(entry);
    return { ok: true, queued: false };
  } catch (e) {
    if (!e.network) throw e;
    queue(entry);
    return { ok: true, queued: true };
  }
}

/** Saves the member's avatar (shown to the whole team). Empty string = back to initials. */
export async function setAvatar({ id, token, avatar }) {
  if (avatar && !isAvatar(avatar)) throw new ApiError('Unknown avatar.');
  if (DEMO) {
    store.set(KEY.demoAvatars, { ...store.get(KEY.demoAvatars, {}), [id]: avatar });
    return { ok: true, avatar };
  }
  return request({ action: 'profile', m: id, t: token, avatar });
}

export async function flushOutbox() {
  const box = store.get(KEY.outbox, []);
  if (!box.length || DEMO) return 0;
  let sent = 0;
  for (const entry of box) {
    try {
      await request({ action: 'log', m: entry.id, t: entry.token, date: entry.date, steps: entry.steps, mode: 'set' });
      dropFromOutbox(entry); sent++;
    } catch (e) {
      if (e.network) break;          // still offline: keep the rest
      dropFromOutbox(entry);         // rejected by the server: discard
    }
  }
  return sent;
}

export const pendingCount = () => store.get(KEY.outbox, []).length;

export function syncUrl(id, token) {
  const base = CONFIG.API_URL || 'https://script.google.com/macros/s/YOUR-DEPLOYMENT/exec';
  const l = lang() === 'en' ? '' : `&lang=${lang()}`; // the Shortcut's "✅ … steps saved" reply comes back in this language
  return `${base}?action=sync&m=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}${l}&steps=`;
}

/* ── Outbox helpers ── */
function queue(entry) {
  const box = store.get(KEY.outbox, []).filter(e => !(e.id === entry.id && e.date === entry.date));
  box.push({ ...entry, queuedAt: Date.now() });
  store.set(KEY.outbox, box);
}
function dropFromOutbox(entry) {
  store.set(KEY.outbox, store.get(KEY.outbox, []).filter(e => !(e.id === entry.id && e.date === entry.date)));
}
function applyOutbox(data) {
  const box = store.get(KEY.outbox, []);
  if (!box.length || !data) return data;
  const copy = { ...data, members: data.members.map(m => ({ ...m, daily: (m.daily || []).slice() })) };
  const dates = datesBetween(copy.challenge.start, copy.challenge.end);
  box.forEach(e => {
    const m = copy.members.find(x => x.id === e.id);
    const i = dates.indexOf(e.date);
    if (m && i >= 0) m.daily[i] = e.steps;
  });
  return copy;
}

/* ── Demo mode: realistic sample data so the dashboard can be previewed ── */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = s => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
const PROFILES = [[7000, 13500], [9000, 16000], [6000, 11500], [9500, 17500], [7500, 12500], [6500, 12000], [8500, 15000], [5500, 11000], [8000, 14500]];

function demoData() {
  const ch = CONFIG.CHALLENGE;
  const t = today();
  const overrides = store.get(KEY.demo, {});
  const pins = store.get(KEY.demoPins, {});
  const synced = store.get(KEY.demoSync, {});
  const avatars = store.get(KEY.demoAvatars, {});
  const dates = datesBetween(ch.start, ch.end);
  const members = CONFIG.ROSTER.map((r, k) => {
    const rand = rng(hash(r.id));
    const [lo, hi] = PROFILES[k % PROFILES.length];
    const daily = dates.map(d => {
      const a = rand(), b = rand(), c = rand();
      const key = `${r.id}|${d}`;
      if (key in overrides) return overrides[key];
      if (d > t) return null;
      if (a < 0.05) return null;
      const weekend = dow(d) === 0 || dow(d) === 6;
      let v = lo + b * (hi - lo);
      if (weekend) v *= 0.7 + c * 0.6;
      if (d === t) v *= 0.6;
      return Math.round(v / 10) * 10;
    });
    return {
      id: r.id, name: r.name, country: r.country, avatar: avatars[r.id] || '',
      joined: k !== 8 || !!pins[r.id],
      lastSyncAt: synced[r.id] || new Date(Date.now() - (k + 1) * 47 * 60000).toISOString(),
      lastSource: synced[r.id] ? 'app' : k % 3 === 0 ? 'shortcut' : 'app',
      autoSyncs: k % 3 === 0 ? 12 : 0,
      daily,
    };
  });
  return { ok: true, demo: true, challenge: ch, updatedAt: new Date().toISOString(), members };
}

function demoClaim(id, pin) {
  const pins = store.get(KEY.demoPins, {});
  if (!/^\d{4}$/.test(pin)) throw new ApiError(t('err.pinDigits'), false, 'pinDigits');
  if (pins[id] && pins[id] !== pin) throw new ApiError(t('err.wrongPin'), false, 'wrongPin');
  const created = !pins[id];
  pins[id] = pin;
  store.set(KEY.demoPins, pins);
  return { ok: true, id, token: `demo-${id}`, created };
}

function demoLog({ id, date, steps }) {
  const o = store.get(KEY.demo, {});
  o[`${id}|${date}`] = steps;
  store.set(KEY.demo, o);
  store.set(KEY.demoSync, { ...store.get(KEY.demoSync, {}), [id]: new Date().toISOString() });
}
