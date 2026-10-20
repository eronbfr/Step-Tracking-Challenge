// Backend client. The backend is the GitHub repository:
//   • reads  — data/data.json (snapshot committed by the Ledger Action) + newer events from the relay topic, live;
//   • writes — messages signed with this device's key, published to the relay; queued offline and re-sent if lost.
// The same ledger.js turns snapshot + events into the dashboard here and in the Action, so everyone sees the same.
import { CONFIG } from './config.js';
import * as L from './ledger.js';
import * as device from './device.js';
import { iso, datesBetween, dow } from './metrics.js';
import { isAvatar } from './avatars.js';

const params = new URLSearchParams(location.search);
export const DEMO = params.has('demo');
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
// Local development can use tools/mock_relay.py instead of ntfy.sh: ?relay=http://localhost:8766
const RELAY = `${(LOCAL && params.get('relay')) || CONFIG.RELAY_URL}/${CONFIG.RELAY_TOPIC}`;
const SNAPSHOTS = LOCAL ? ['./data/data.json'] : [CONFIG.DATA_URL, './data/data.json'];
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

const KEY = {
  view: 't8:view', snap: 't8:snapshot', tail: 't8:tail', outbox: 't8:outbox2', sent: 't8:sent',
  demo: 't8:demo', demoJoined: 't8:demo-joined', demoSync: 't8:demo-sync', demoAvatars: 't8:demo-avatars',
};
['t8:data', 't8:outbox', 't8:demo-pins'].forEach(store.del); // v1 (Google Apps Script) leftovers

/* ── Local mirror of the ledger ── */
let snapshot = store.get(KEY.snap);                                     // newest data/data.json seen
const tail = new Map((store.get(KEY.tail) || []).map(e => [e.id, e]));  // relay events (id → { id, time, message })
let relayOk = false;

const slim = e => ({ id: e.id, time: e.time, message: e.message });
const saveTail = () => store.set(KEY.tail, [...tail.values()].slice(-400));
const nowSec = () => Math.floor(Date.now() / 1000);
const cursorTime = () => (snapshot && snapshot.cursor && snapshot.cursor.time) || 0;

async function http(url, { timeout = 15000, ...init } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, { cache: 'no-store', ...init, signal: ctrl.signal });
  } catch (e) {
    throw new ApiError(e.name === 'AbortError' ? 'timeout' : 'offline', true, e.name === 'AbortError' ? 'timeout' : 'offline');
  } finally {
    clearTimeout(timer);
  }
}

async function loadSnapshot() {
  const got = await Promise.allSettled(SNAPSHOTS.map(async u => {
    const res = await http(`${u}?t=${Date.now()}`);
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status >= 500);
    return res.json();
  }));
  const good = got.filter(r => r.status === 'fulfilled' && r.value && r.value.v === L.VERSION).map(r => r.value);
  if (!good.length) throw new ApiError('offline', true, 'offline');
  const best = good.reduce((a, b) => ((b.cursor && b.cursor.time) > (a.cursor && a.cursor.time) ? b : a));
  if (!snapshot || ((best.cursor && best.cursor.time) || 0) >= cursorTime()) snapshot = best; // never step back in time
  store.set(KEY.snap, snapshot);
  const old = nowSec() - 13 * 3600;
  for (const [id, e] of tail) if (snapshot.cursor.seen[id] || e.time < old) tail.delete(id);
  saveTail();
}

/** Relay events newer than the snapshot. ntfy answers newline-delimited JSON; `since` is unix seconds. */
async function loadTail() {
  const since = cursorTime() ? cursorTime() - 600 : 'all';
  const res = await http(`${RELAY}/json?poll=1&since=${since}`);
  if (!res.ok) throw new ApiError(`relay HTTP ${res.status}`, true, 'relay');
  const ids = new Set();
  (await res.text()).split('\n').forEach(line => {
    if (!line.trim()) return;
    try { const e = JSON.parse(line); if (e.event === 'message') { tail.set(e.id, slim(e)); ids.add(e.id); } } catch { /* skip */ }
  });
  saveTail();
  relayOk = true;
  return { since, ids };
}

let chain = Promise.resolve();
async function build() {
  const st = L.normalize(snapshot);
  await L.applyEvents(st, [...tail.values()]);
  const box = store.get(KEY.outbox, []);
  if (box.length) await L.applyEvents(st, box.map((o, k) => ({ id: `local:${k}`, time: Math.floor(o.at / 1000), message: o.body })), { local: true });
  const view = L.toView(st);
  const last = Math.max(0, ...[...tail.values()].map(e => e.time));
  if (last && (!view.updatedAt || last * 1000 > Date.parse(view.updatedAt))) view.updatedAt = new Date(last * 1000).toISOString();
  view.live = relayOk;
  store.set(KEY.view, view);
  return view;
}
const compute = () => (chain = chain.then(build, build));

/* ── Publishing ── */
async function publish(body, { remember = true } = {}) {
  const res = await http(RELAY, { method: 'POST', body }); // text/plain → no CORS preflight
  if (!res.ok) throw new ApiError(`relay HTTP ${res.status}`, res.status === 429 || res.status >= 500, 'relay');
  const ev = await res.json();
  tail.set(ev.id, slim(ev));
  saveTail();
  if (remember) store.set(KEY.sent, [...store.get(KEY.sent, []), { id: ev.id, time: ev.time, body }].slice(-200));
  return ev;
}

async function send(type, member, fields = {}) {
  const me = await device.key();
  const msg = { v: 1, t: type, m: member, ts: Date.now(), kid: me.kid, ...fields };
  msg.sig = await device.sign(L.canonical(msg));
  const body = JSON.stringify(msg);
  try {
    await publish(body);
    return { ok: true, queued: false };
  } catch (e) {
    if (!e.network) throw e;
    store.set(KEY.outbox, [...store.get(KEY.outbox, []), { at: Date.now(), body }]);
    return { ok: true, queued: true };
  }
}

/**
 * Messages this device sent that are inside the relay window we just read, yet neither there nor in the snapshot
 * (relay cache loss, Action down for hours…), are published again. Only kinds whose result doesn't depend on order:
 * last-write-wins edits, and this device's own claim (so it doesn't get signed out).
 */
const RESENDABLE = ['log', 'avatar', 'synckey'];
async function rescueLost({ since, ids }) {
  const before = store.get(KEY.sent, []);
  const myKid = (await device.key()).kid;
  const next = [];
  for (const s of before) {
    if ((snapshot && snapshot.cursor.seen[s.id]) || s.time < nowSec() - 12 * 3600) continue; // folded, or past the relay's memory
    let msg = {};
    try { msg = JSON.parse(s.body); } catch { /* not ours */ }
    const resend = RESENDABLE.includes(msg.t) || (msg.t === 'claim' && msg.kid === myKid);
    if (ids.has(s.id) || (since !== 'all' && s.time < since) || !resend) { next.push(s); continue; }
    try { const ev = await publish(s.body, { remember: false }); next.push({ id: ev.id, time: ev.time, body: s.body }); } catch { next.push(s); }
  }
  const known = new Set(before.map(s => s.id));
  const added = store.get(KEY.sent, []).filter(s => !known.has(s.id)); // sent by other flows meanwhile
  store.set(KEY.sent, [...next, ...added].slice(-200));
}

/* ═════════════ Public API ═════════════ */
export function cachedData() {
  return DEMO ? null : store.get(KEY.view);
}

export async function fetchData() {
  if (DEMO) return demoData();
  let snapErr = null, tailInfo = null;
  try { await loadSnapshot(); } catch (e) { snapErr = e; }
  try { tailInfo = await loadTail(); } catch { relayOk = false; }
  if (!snapshot && !tailInfo) throw snapErr || new ApiError('offline', true, 'offline');
  if (tailInfo) await rescueLost(tailInfo);
  return compute();
}

/** Publishes messages queued while offline, oldest first. Returns how many went out. */
export async function flushOutbox() {
  if (DEMO) return 0;
  let sent = 0;
  for (const o of store.get(KEY.outbox, [])) {
    try {
      await publish(o.body);
      sent++;
    } catch (e) {
      if (e.network) break; // still offline: keep the rest, in order
    }
    store.set(KEY.outbox, store.get(KEY.outbox, []).filter(x => x.body !== o.body)); // sent, or refused for good
  }
  return sent;
}

export const pendingCount = () => store.get(KEY.outbox, []).length;

/** The view as of now, including what this device just sent (no network). */
export const current = () => (DEMO ? Promise.resolve(demoData()) : compute());

/** Live updates: every open app gets each new message within a second (Server-Sent Events from the relay). */
export function live(onChange) {
  if (DEMO || typeof EventSource === 'undefined') return;
  let es = null, timer = 0;
  const open = () => {
    if (es || document.visibilityState !== 'visible') return;
    const last = Math.max(cursorTime(), ...[...tail.values()].map(e => e.time));
    es = new EventSource(`${RELAY}/sse?since=${last ? last - 60 : 'all'}`);
    es.onmessage = e => {
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }
      if (ev.event !== 'message' || tail.has(ev.id)) return;
      tail.set(ev.id, slim(ev));
      saveTail();
      relayOk = true;
      clearTimeout(timer);
      timer = setTimeout(async () => onChange(await compute()), 120);
    };
  };
  const close = () => { if (es) { es.close(); es = null; } };
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? open() : close()));
  addEventListener('online', () => { close(); open(); });
  open();
}

/** This device's key id ('' when WebCrypto is unavailable). */
export async function deviceKid() {
  if (DEMO) return 'demo-device';
  try { return (await device.key()).kid; } catch { return ''; }
}

/**
 * Join as `member`. Free name → this device becomes theirs right away ("joined").
 * Already taken → a request one of their devices (or the captain) must approve ("requested").
 */
export async function claim(member) {
  if (DEMO) { store.set(KEY.demoJoined, { ...store.get(KEY.demoJoined, {}), [member]: true }); return { status: 'joined', view: demoData() }; }
  const me = await device.key();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const r = await send('claim', member, { pub: me.pub, tz, l: device.deviceLabel() });
  const view = await compute();
  const m = view.members.find(x => x.id === member);
  return { ...r, view, status: m && m.keys.some(k => k.kid === me.kid) ? 'joined' : 'requested' };
}

export async function logSteps({ id, date, steps }) {
  if (DEMO) { demoLog({ id, date, steps }); return { ok: true, queued: false }; }
  return send('log', id, { d: date, s: steps });
}

/** Saves the member's avatar (shown to the whole team). Empty string = back to initials. */
export async function setAvatar({ id, avatar }) {
  if (avatar && !isAvatar(avatar)) throw new ApiError('Unknown avatar.');
  if (DEMO) { store.set(KEY.demoAvatars, { ...store.get(KEY.demoAvatars, {}), [id]: avatar }); return { ok: true }; }
  return send('avatar', id, { a: avatar });
}

export const approve = (member, kid) => (DEMO ? Promise.resolve({ ok: true }) : send('approve', member, { k: kid }));
export const deny = (member, kid) => (DEMO ? Promise.resolve({ ok: true }) : send('deny', member, { k: kid }));
export const revoke = (member, kid) => (DEMO ? Promise.resolve({ ok: true }) : send('revoke', member, { k: kid }));
export const resetMember = member => (DEMO ? Promise.resolve({ ok: true }) : send('reset', member));

/** Removes this device from the member's devices and forgets its key. */
export async function signOut(member, { cancelRequest = false } = {}) {
  if (DEMO) { store.set(KEY.demoJoined, { ...store.get(KEY.demoJoined, {}), [member]: false }); return; }
  try {
    const { kid } = await device.key();
    await send(cancelRequest ? 'deny' : 'revoke', member, { k: kid });
  } catch { /* best effort */ }
  store.del(KEY.sent); // nothing signed by the old key should ever be re-sent
  await device.forget();
}

/* ── Auto-sync link (iPhone Shortcut, Tasker…) ── */
const syncKeyStore = id => `t8:synckey:${id}`;
const syncUrl = (id, key) => `${RELAY}/publish?message=sync%20${encodeURIComponent(id)}%20${key}%20`;
/** The link already created on this device ('' if none). */
export const storedSyncLink = id => { const k = store.get(syncKeyStore(id)); return k ? syncUrl(id, k) : ''; };
/** Creates (or rotates) the personal sync key and registers its hash in the ledger. */
export async function syncLink(id, member, { rotate = false } = {}) {
  if (DEMO) return syncUrl(id, 'demo-key');
  let k = store.get(syncKeyStore(id));
  if (!k || rotate) { k = L.b64u(crypto.getRandomValues(new Uint8Array(16))); store.set(syncKeyStore(id), k); }
  const h = await L.sha256Hex(k);
  if (!member || member.syncHash !== h) await send('synckey', id, { h });
  return syncUrl(id, k);
}

/* ── Demo mode: realistic sample data so the dashboard can be previewed (?demo) ── */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = s => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
const PROFILES = [[7000, 13500], [9000, 16000], [6000, 11500], [9500, 17500], [7500, 12500], [6500, 12000], [8500, 15000], [5500, 11000], [8000, 14500]];
const DEMO_AVATARS = ['m5', 'm13', 'm2', 'm1', 'f9', 'm16', 'm10', '', 'f11'];

function demoData() {
  const ch = CONFIG.CHALLENGE;
  const t = today();
  const overrides = store.get(KEY.demo, {});
  const joined = store.get(KEY.demoJoined, {});
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
    const mine = !!joined[r.id];
    return {
      id: r.id, name: r.name, country: r.country, avatar: r.id in avatars ? avatars[r.id] : DEMO_AVATARS[k] || '',
      joined: k !== 8 || mine,
      lastSyncAt: synced[r.id] || new Date(Date.now() - (k + 1) * 47 * 60000).toISOString(),
      lastSource: synced[r.id] ? 'app' : k % 3 === 0 ? 'shortcut' : 'app',
      autoSyncs: k % 3 === 0 ? 12 : 0,
      keys: mine ? [{ kid: 'demo-device', l: 'Demo', at: new Date().toISOString() }] : [], requests: [], syncHash: '',
      daily,
    };
  });
  return { ok: true, demo: true, challenge: ch, admins: CONFIG.ADMINS, updatedAt: new Date().toISOString(), live: true, members };
}

function demoLog({ id, date, steps }) {
  const o = store.get(KEY.demo, {});
  o[`${id}|${date}`] = steps;
  store.set(KEY.demo, o);
  store.set(KEY.demoSync, { ...store.get(KEY.demoSync, {}), [id]: new Date().toISOString() });
}
