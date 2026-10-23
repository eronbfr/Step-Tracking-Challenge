// The ledger: an event-sourced state machine shared by the app and the GitHub Action (backend/fold.mjs).
//
//   snapshot (data/data.json, committed by the Action)  +  relay events newer than snapshot.cursor  =  live state
//
// Every app message is signed with the device's ECDSA P-256 key (WebCrypto); the public keys live in the snapshot.
// The app and the Action run this exact file, so what a phone shows live is what the spreadsheet will say.
// No DOM, no storage: works in browsers and in Node ≥ 20 (global WebCrypto, atob/btoa).
import { CONFIG } from './config.js';
import { isAvatar } from './avatars.js';

export const VERSION = 2;
export const MAX_STEPS = 100000;
const GRACE_DAYS = 7;           // late edits allowed for a week after the end
const SEEN_SECONDS = 13 * 3600; // the relay keeps messages for 12 h
const MAX_KEYS = 8, MAX_REQUESTS = 4;
// Stories: the media travels as relay attachments (≤ 2 MiB each, so bigger files come in parts) and the Action copies it
// to the `stories` branch. The ledger keeps what a story is, who saw it and the reactions, for two days.
export const STORY = {
  TTL: 24 * 3600, KEEP: 48 * 3600, MAX_PARTS: 6, MAX_BYTES: 12 * 1024 * 1024, MAX_SECONDS: 61, PER_DAY: 30,
  MIME: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' },
  REACTIONS: ['❤️', '🔥', '👏', '😂', '😮', '😍', '💪', '🎉'],
};
const PART_URL = /^https?:\/\/[^\s/?#]+\/file\/[A-Za-z0-9_-]+(\.[A-Za-z0-9]{1,5})?$/;
const TZ_BY_COUNTRY = { BR: 'America/Sao_Paulo', MX: 'America/Mexico_City', UY: 'America/Montevideo', CO: 'America/Bogota' };
const DEFAULT_TZ = 'America/Sao_Paulo';

/* ───────────── Encoding & crypto helpers ───────────── */
const subtle = () => globalThis.crypto.subtle;
const utf8 = s => new TextEncoder().encode(s);
export const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), c => c.charCodeAt(0));

export const sha256Hex = async text => hex(await subtle().digest('SHA-256', utf8(text)));
/** Key id = first 16 hex chars of SHA-256(raw public key). */
export const kidOf = async pub => hex(await subtle().digest('SHA-256', unb64u(pub))).slice(0, 16);
/** 4-digit code both devices show while a sign-in request waits for approval. */
export const codeOf = kid => String(parseInt(String(kid).slice(0, 8), 16) % 10000).padStart(4, '0');
/** The exact text that gets signed: the message without `sig`, keys sorted. */
export const canonical = msg => { const { sig, ...rest } = msg; return JSON.stringify(Object.keys(rest).sort().map(k => [k, rest[k]])); };

const pubKeys = new Map();
const verified = new Map(); // `${pub}|${signed text}|${sig}` → boolean (re-reductions are cheap)
async function verifySig(msg, pub) {
  const text = canonical(msg);
  const memo = `${pub}|${text}|${msg.sig}`;
  if (verified.has(memo)) return verified.get(memo);
  let ok = false;
  try {
    if (!pubKeys.has(pub)) pubKeys.set(pub, await subtle().importKey('raw', unb64u(pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']));
    ok = await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKeys.get(pub), unb64u(msg.sig), utf8(text));
  } catch { ok = false; }
  verified.set(memo, ok);
  return ok;
}

/* ───────────── Dates ───────────── */
export const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
export function datesOf(ch) { const out = []; for (let d = ch.start; d <= ch.end; d = addDays(d, 1)) out.push(d); return out; }
const DTF = new Map();
export function validTz(tz) {
  if (!tz || typeof tz !== 'string' || tz.length > 64) return '';
  try { if (!DTF.has(tz)) DTF.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })); return tz; } catch { return ''; }
}
/** Calendar day (yyyy-mm-dd) at instant `ms` in time zone `tz`. */
export function localDate(ms, tz) {
  const z = validTz(tz) || DEFAULT_TZ;
  const p = Object.fromEntries(DTF.get(z).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const isoAt = sec => new Date(sec * 1000).toISOString();

/** "12,345" · "12.345" · "12345,0" · 12345 → 12345 (null when unreadable). */
export function parseSteps(raw) {
  let s = String(raw ?? '').replace(/[\s  ']/g, '');
  if (!s) return null;
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  else s = s.replace(',', '.');
  const n = Math.round(Number(s));
  return Number.isFinite(n) ? n : null;
}

/* ───────────── State ───────────── */
function blankMember(r, N) {
  return {
    id: r.id, name: r.name, country: r.country || '', tz: TZ_BY_COUNTRY[r.country] || DEFAULT_TZ,
    avatar: '', avatarTs: 0, keys: [], requests: [], syncHash: '', syncTs: 0,
    daily: Array(N).fill(null), stamps: Array(N).fill(0),
    joinedAt: '', lastSyncAt: '', lastSource: '', autoSyncs: 0,
    syncIssue: null, // { at, code: 'zero' | 'empty' }: the last automatic sync arrived without a usable step count
  };
}

/** A clean state for `cfg`, merging whatever a (possibly older or partial) snapshot already holds. */
export function normalize(raw, cfg = CONFIG) {
  const challenge = { ...cfg.CHALLENGE, admins: [...(cfg.ADMINS || [])] };
  const N = datesOf(challenge).length;
  const old = raw && raw.v === VERSION && Array.isArray(raw.members) ? structuredClone(raw) : null; // never mutate the input
  const byId = new Map((old ? old.members : []).map(m => [m.id, m]));
  const fit = (a, fill) => { const out = Array.isArray(a) ? a.slice(0, N) : []; while (out.length < N) out.push(fill); return out; };
  const merge = (r, m) => {
    const base = blankMember(r, N);
    if (!m) return base;
    return {
      ...base, ...m, name: r.name || m.name, country: r.country || m.country,
      keys: Array.isArray(m.keys) ? m.keys : [], requests: Array.isArray(m.requests) ? m.requests : [],
      daily: fit(m.daily, null), stamps: fit(m.stamps, 0),
    };
  };
  const members = cfg.ROSTER.map(r => merge(r, byId.get(r.id)));
  if (old) old.members.forEach(m => { if (!cfg.ROSTER.some(r => r.id === m.id)) members.push(merge(m, m)); });
  const cursor = old && old.cursor ? { time: Number(old.cursor.time) || 0, seen: { ...(old.cursor.seen || {}) } } : { time: 0, seen: {} };
  const stories = (old && Array.isArray(old.stories) ? old.stories : []).filter(s => s && s.id && s.m).map(s => ({
    ...s, p: Array.isArray(s.p) ? s.p : [], mn: Array.isArray(s.mn) ? s.mn : [], src: s.src || '',
    views: s.views && typeof s.views === 'object' ? s.views : {},
    reacts: Array.isArray(s.reacts) ? s.reacts : [], replies: Array.isArray(s.replies) ? s.replies : [],
  }));
  return { v: VERSION, challenge, updatedAt: (old && old.updatedAt) || null, cursor, members, stories };
}

/** What the screens need (no signing material beyond public key ids). */
export function toView(state) {
  const { team, name, start, end, dailyGoal, admins } = state.challenge;
  return {
    ok: true,
    challenge: { team, name, start, end, dailyGoal },
    admins: admins || [],
    updatedAt: state.updatedAt,
    cursorTime: state.cursor.time,
    members: state.members.map(m => ({
      id: m.id, name: m.name, country: m.country, avatar: isAvatar(m.avatar) ? m.avatar : '',
      joined: m.keys.length > 0, joinedAt: m.joinedAt, lastSyncAt: m.lastSyncAt, lastSource: m.lastSource, autoSyncs: m.autoSyncs,
      syncIssue: m.syncIssue ? { ...m.syncIssue } : null,
      daily: m.daily.slice(), syncHash: m.syncHash,
      keys: m.keys.map(({ kid, l, at }) => ({ kid, l, at })), requests: m.requests.map(({ kid, l, at }) => ({ kid, l, at })),
    })),
    stories: (state.stories || []).map(s => ({
      ...s, p: s.p.slice(), mn: (s.mn || []).slice(), views: { ...s.views },
      reacts: s.reacts.map(r => ({ ...r })), replies: s.replies.map(r => ({ ...r })),
    })),
  };
}

/* ───────────── Reducer ───────────── */
const res = (ok, code, extra = {}) => ({ ok, code, ...extra });
const label = l => String(l || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 40);
const findMember = (state, id) => state.members.find(m => m.id === String(id || '').toLowerCase());
const adminKeys = state => state.members.filter(m => (state.challenge.admins || []).includes(m.id)).flatMap(m => m.keys);

/**
 * Applies relay events ({ id, time: unix seconds, message }) in order. Mutates `state`.
 * Events already in state.cursor.seen are skipped. Returns one result per new event.
 * `local: true` = optimistic events from this device's outbox: applied but never recorded in the cursor.
 */
export async function applyEvents(state, events, { local = false } = {}) {
  const out = [];
  const list = events.filter(e => e && typeof e.message === 'string' && (!e.event || e.event === 'message'))
    .map((e, k) => [e, k]).sort((a, b) => a[0].time - b[0].time || a[1] - b[1]).map(x => x[0]);
  for (const ev of list) {
    if (!local && state.cursor.seen[ev.id]) continue;
    let r;
    try { r = await applyOne(state, ev); } catch (err) { r = res(false, 'crash', { error: String(err && err.message || err) }); }
    out.push({ id: ev.id, time: ev.time, ...r });
    if (!local) {
      state.cursor.seen[ev.id] = ev.time;
      state.cursor.time = Math.max(state.cursor.time, ev.time);
    }
  }
  if (!local) {
    const floor = state.cursor.time - SEEN_SECONDS;
    for (const [id, t] of Object.entries(state.cursor.seen)) if (t < floor) delete state.cursor.seen[id];
    state.stories = state.stories.filter(s => s.at >= state.cursor.time - STORY.KEEP);
  }
  return out;
}

async function applyOne(state, ev) {
  const text = ev.message.trim();
  if (/^sync\s/i.test(text)) return applyShortcut(state, ev, text);
  let msg;
  try { msg = JSON.parse(text); } catch { return res(false, 'notJson'); }
  if (msg && msg.v === 1 && msg.t === 'blob') return res(true, 'blob'); // a story's media part; the signed 'story' message names it
  if (!msg || typeof msg !== 'object' || msg.v !== 1 || typeof msg.t !== 'string' || typeof msg.sig !== 'string') return res(false, 'badMessage');
  const m = findMember(state, msg.m);
  if (!m) return res(false, 'unknownMember');
  const ts = Math.min(Number(msg.ts) || 0, ev.time * 1000 + 5 * 60000); // no stamps from the future
  const base = { t: msg.t, m: m.id };

  if (msg.t === 'claim') {
    if (typeof msg.pub !== 'string' || msg.kid !== await kidOf(msg.pub).catch(() => '')) return res(false, 'badKey', base);
    if (!await verifySig(msg, msg.pub)) return res(false, 'badSignature', base);
    if (m.keys.some(k => k.kid === msg.kid)) return res(true, 'alreadyMember', base);
    const entry = { kid: msg.kid, pub: msg.pub, l: label(msg.l), at: isoAt(ev.time) };
    if (!m.keys.length) {
      m.keys.push(entry);
      m.requests = m.requests.filter(r => r.kid !== msg.kid);
      m.tz = validTz(msg.tz) || m.tz;
      m.joinedAt = m.joinedAt || entry.at;
      return res(true, 'joined', base);
    }
    if (!m.requests.some(r => r.kid === msg.kid)) m.requests = [...m.requests, entry].slice(-MAX_REQUESTS);
    return res(true, 'requested', base);
  }

  // Everything else must be signed by a known key: the member's own, an admin's, or (to cancel) the requester's.
  const own = m.keys.find(k => k.kid === msg.kid);
  const admin = adminKeys(state).find(k => k.kid === msg.kid);
  const requester = msg.t === 'deny' && msg.k === msg.kid ? m.requests.find(r => r.kid === msg.kid) : null;
  const signer = own || admin || requester;
  if (!signer) return res(false, 'unknownKey', base);
  if (!await verifySig(msg, signer.pub)) return res(false, 'badSignature', base);
  const memberOrAdmin = own || admin;

  switch (msg.t) {
    case 'approve': {
      if (!memberOrAdmin) return res(false, 'notAllowed', base);
      if (m.keys.some(k => k.kid === msg.k)) return res(true, 'alreadyMember', base);
      const r = m.requests.find(x => x.kid === msg.k);
      if (!r) return res(false, 'noRequest', base);
      m.requests = m.requests.filter(x => x.kid !== msg.k);
      m.keys = [...m.keys, r].slice(-MAX_KEYS);
      return res(true, 'approved', base);
    }
    case 'deny': {
      m.requests = m.requests.filter(x => x.kid !== msg.k);
      return res(true, 'denied', base);
    }
    case 'revoke': {
      if (!memberOrAdmin) return res(false, 'notAllowed', base);
      m.keys = m.keys.filter(k => k.kid !== msg.k);
      return res(true, 'revoked', base);
    }
    case 'reset': {
      if (!admin) return res(false, 'notAllowed', base);
      m.keys = []; m.requests = []; m.syncHash = ''; m.syncTs = ts;
      return res(true, 'reset', base);
    }
    case 'avatar': {
      if (!own) return res(false, 'notAllowed', base);
      const a = String(msg.a || '');
      if (a && !isAvatar(a)) return res(false, 'badAvatar', base);
      if (ts < m.avatarTs) return res(true, 'stale', base);
      m.avatar = a; m.avatarTs = ts;
      return res(true, 'avatar', base);
    }
    case 'synckey': {
      if (!own) return res(false, 'notAllowed', base);
      if (!/^[0-9a-f]{64}$/.test(String(msg.h || ''))) return res(false, 'badKey', base);
      if (ts < m.syncTs) return res(true, 'stale', base);
      m.syncHash = msg.h; m.syncTs = ts;
      return res(true, 'synckey', base);
    }
    case 'log': {
      if (!own) return res(false, 'notAllowed', base);
      const steps = typeof msg.s === 'number' ? Math.round(msg.s) : parseSteps(msg.s);
      return setSteps(state, m, ev, { date: msg.d, steps, ts, mode: 'set', source: 'app' }, base);
    }
    case 'story': return own ? addStory(state, m, ev, msg, base) : res(false, 'notAllowed', base);
    case 'unstory': {
      const s = storyOf(state, msg.sid);
      if (!s || s.m !== m.id) return res(true, 'gone', base);
      if (!memberOrAdmin) return res(false, 'notAllowed', base);
      state.stories = state.stories.filter(x => x !== s);
      return res(true, 'unstory', { ...base, sid: s.id });
    }
    case 'seen': {
      if (!own) return res(false, 'notAllowed', base);
      const ids = Array.isArray(msg.s) ? msg.s.slice(0, 60).map(String) : [];
      state.stories.forEach(s => { if (ids.includes(s.id) && s.m !== m.id && !s.views[m.id]) s.views[m.id] = ev.time; });
      return res(true, 'seen', base);
    }
    case 'react':
    case 'reply': {
      if (!own) return res(false, 'notAllowed', base);
      const s = storyOf(state, msg.sid);
      if (!s) return res(true, 'gone', base);
      if (s.m === m.id) return res(false, 'notAllowed', base);
      if (msg.t === 'react') {
        if (!STORY.REACTIONS.includes(msg.e)) return res(false, 'badReaction', base);
        s.reacts = [...s.reacts, { m: m.id, e: msg.e, at: ev.time }].slice(-60);
      } else {
        const x = String(msg.x || '').replace(/[\u0000-\u0009\u000b-\u001f]/g, '').trim().slice(0, 300);
        if (!x) return res(false, 'empty', base);
        s.replies = [...s.replies, { m: m.id, x, at: ev.time }].slice(-40);
      }
      if (!s.views[m.id]) s.views[m.id] = ev.time;
      return res(true, msg.t, { ...base, sid: s.id, owner: s.m });
    }
    default:
      return res(false, 'unknownType', base);
  }
}

/* ───────────── Stories ───────────── */
const storyOf = (state, sid) => state.stories.find(s => s.id === String(sid || ''));
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

function addStory(state, m, ev, msg, base) {
  const sid = String(msg.sid || '');
  if (!/^[A-Za-z0-9_-]{8,24}$/.test(sid)) return res(false, 'badStory', base);
  if (storyOf(state, sid)) return res(true, 'alreadyPosted', base);
  const kind = msg.k === 'video' ? 'video' : msg.k === 'image' ? 'image' : '';
  const parts = Array.isArray(msg.p) ? msg.p.map(String) : [];
  const ok = kind && STORY.MIME[msg.mt] && msg.mt.startsWith(kind) && /^[0-9a-f]{64}$/.test(String(msg.sha || ''))
    && parts.length >= 1 && parts.length <= STORY.MAX_PARTS && parts.every(u => PART_URL.test(u))
    && num(msg.sz, 1, STORY.MAX_BYTES) != null && num(msg.w, 16, 4096) != null && num(msg.h, 16, 4096) != null
    && (kind === 'image' || num(msg.du, 0.3, STORY.MAX_SECONDS) != null);
  if (!ok) return res(false, 'badStory', base);
  if (state.stories.filter(s => s.m === m.id && s.at > ev.time - 86400).length >= STORY.PER_DAY) return res(false, 'tooMany', base);
  const ids = new Set(state.members.map(x => x.id));
  state.stories.push({
    id: sid, m: m.id, at: ev.time, k: kind, mt: msg.mt, p: parts, sz: msg.sz, sha: msg.sha, w: Math.round(msg.w), h: Math.round(msg.h),
    du: kind === 'video' ? Math.round(msg.du * 10) / 10 : 0,
    x: String(msg.x || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300),
    mn: (Array.isArray(msg.mn) ? msg.mn : []).map(String).filter(id => ids.has(id) && id !== m.id).slice(0, 9),
    bg: /^#[0-9a-f]{6}$/i.test(String(msg.bg || '')) ? msg.bg : '',
    src: '', views: {}, reacts: [], replies: [],
  });
  state.stories.sort((a, b) => a.at - b.at);
  return res(true, 'story', { ...base, sid });
}

/** Stories still on air at unix time `now` (seconds), oldest first. */
export const liveStories = (stories, now) => (stories || []).filter(s => s.at > now - STORY.TTL && s.at <= now + 300);

/** iPhone Shortcut / automation: plain text "sync <member> <sync-key> <steps> [yyyy-mm-dd]". Keeps the highest value. */
async function applyShortcut(state, ev, text) {
  const [, id, key, raw, date] = text.split(/\s+/);
  const m = findMember(state, id);
  if (!m) return res(false, 'unknownMember', { t: 'sync' });
  const base = { t: 'sync', m: m.id };
  if (!m.syncHash || !key || await sha256Hex(key) !== m.syncHash) return res(false, 'badSyncKey', base);
  const steps = parseSteps(raw);
  // 0 = Health gave nothing (iPhone locked, or no Health access); nothing = the link was opened without the steps.
  // Neither is a real reading: keep the day untouched and flag it so the member's app explains what to fix.
  if (!steps) {
    const at = isoAt(ev.time);
    if (!m.syncIssue || at >= m.syncIssue.at) m.syncIssue = { at, code: steps === 0 ? 'zero' : 'empty' };
    return res(true, 'noSteps', base);
  }
  const r = setSteps(state, m, ev, { date, steps, ts: ev.time * 1000, mode: 'max', source: 'shortcut' }, base);
  if (r.ok && m.syncIssue && isoAt(ev.time) >= m.syncIssue.at) m.syncIssue = null;
  return r;
}

function setSteps(state, m, ev, { date, steps, ts, mode, source }, base) {
  const ch = state.challenge;
  const today = localDate(ev.time * 1000, m.tz);
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : date ? null : today;
  if (!d) return res(false, 'badDate', base);
  if (steps == null || steps < 0) return res(false, 'badSteps', base);
  if (steps > MAX_STEPS) return res(false, 'tooHigh', base);
  if (d < ch.start) return res(false, 'notStarted', base);
  if (d > ch.end) return res(false, 'ended', base);
  if (d > addDays(today, 1)) return res(false, 'futureDay', base);
  if (today > addDays(ch.end, GRACE_DAYS)) return res(false, 'closed', base);
  const i = datesOf(ch).indexOf(d);
  const before = m.daily[i];
  const touch = () => {
    const at = isoAt(ev.time);
    if (!m.lastSyncAt || at >= m.lastSyncAt) { m.lastSyncAt = at; m.lastSource = source; }
    if (source !== 'app') m.autoSyncs += 1;
  };
  if (mode === 'max') {
    touch();
    const next = Math.max(before || 0, steps);
    if (next === before) return res(true, 'unchanged', { ...base, d, s: before });
    m.daily[i] = next; m.stamps[i] = Math.max(m.stamps[i], ts);
    return res(true, 'steps', { ...base, d, s: next, before, source });
  }
  if (ts < m.stamps[i]) return res(true, 'stale', { ...base, d });
  touch();
  m.stamps[i] = ts;
  if (steps === before) return res(true, 'unchanged', { ...base, d, s: before });
  m.daily[i] = steps;
  return res(true, 'steps', { ...base, d, s: steps, before, source });
}
