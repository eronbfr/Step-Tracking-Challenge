// Stories: the avatar rail in the top bar and the full-screen viewer — tap to skip, hold to pause, swipe sideways
// (cube) to the next person, swipe down to close, reply or react. Stories stay on air for 24 h (js/ledger.js STORY).
import { liveStories, STORY } from './ledger.js';
import * as api from './api.js';
import { t } from './i18n.js';
import { $, esc, avatar, icon, toast, ago, reducedMotion, lockScroll, unlockScroll } from './ui.js';

const IMAGE_MS = 5500;
const SEEN = 't8:seen', UNSENT = 't8:seen-unsent';
const now = () => Math.floor(Date.now() / 1000);

let app = null; // { state, compose(), openMember(id), signin(then), changed() }
let seen = api.store.get(SEEN, {});
const unsent = new Set(api.store.get(UNSENT, []));
let upload = null; // { p } while this device is posting a story
let prevStories = null;
let railHtml = '';

export function initStories(hooks) {
  app = hooks;
  const cut = now() - 3 * 86400;
  seen = Object.fromEntries(Object.entries(seen).filter(([, at]) => at > cut));
  api.store.set(SEEN, seen);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSeen();
    if (V) (document.visibilityState === 'hidden' ? pause : resume)('hidden');
  });
  addEventListener('popstate', () => { if (V && V.pushed) { V.pushed = false; closeViewer(); } });
  addEventListener('resize', measure);
  document.addEventListener('keydown', e => {
    if (!V || (e.target.closest && e.target.closest('input, textarea'))) return;
    if (e.key === 'Escape') closeViewer();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key === ' ') { e.preventDefault(); (V.pauses.has('key') ? resume : pause)('key'); }
  });
  // compact rail once the page scrolls — with hysteresis, checked once per frame
  let compact = false, ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const c = compact ? scrollY > 12 : scrollY > 48;
      if (c !== compact) { compact = c; document.body.classList.toggle('rail-compact', c); }
    });
  }, { passive: true });
  setInterval(() => { if (document.visibilityState === 'visible') renderRail(); }, 60000); // stories expire
}

/* ═════════════ Data ═════════════ */
const meId = () => (app.state.me ? app.state.me.id : '');
const memberOf = id => app.state.model && app.state.model.byId[id];
const isSeen = s => !!seen[s.id] || (!!meId() && s.m !== meId() && !!(s.views && s.views[meId()]));

function groups() {
  const out = new Map();
  const st = app.state;
  if (!st.data || !st.model) return out;
  for (const s of liveStories(st.data.stories, now())) {
    if (!memberOf(s.m)) continue;
    if (!out.has(s.m)) out.set(s.m, []);
    out.get(s.m).push(s);
  }
  return out;
}

/** Rail order: you, then unseen stories (newest first), seen ones, and everyone else in roster order. */
function order(g) {
  const me = meId();
  const latest = id => Math.max(...g.get(id).map(s => s.at));
  const others = app.state.model.members.map(m => m.id).filter(id => id !== me);
  const withStories = others.filter(id => g.has(id)).sort((a, b) => latest(b) - latest(a));
  const fresh = withStories.filter(id => g.get(id).some(s => !isSeen(s)));
  return [...(me ? [me] : []), ...fresh, ...withStories.filter(id => !fresh.includes(id)), ...others.filter(id => !g.has(id))];
}

const firstUnseen = list => { const i = list.findIndex(s => !isSeen(s)); return i < 0 ? 0 : i; };

function markSeen(s) {
  if (seen[s.id]) return;
  seen[s.id] = now();
  api.store.set(SEEN, seen);
  if (meId() && s.m !== meId() && !s.demo) { unsent.add(s.id); api.store.set(UNSENT, [...unsent]); }
}

/** One relay message per viewing session with every story seen (the relay counts messages per day). */
export function flushSeen() {
  const me = meId();
  if (!me || !unsent.size) return;
  const ids = [...unsent];
  api.markSeen(me, ids).then(() => {
    ids.forEach(id => unsent.delete(id));
    api.store.set(UNSENT, [...unsent]);
  }).catch(() => {});
}

/* ═════════════ Rail ═════════════ */
export function renderRail() {
  const host = $('#rail');
  if (!host || !app || !app.state.model) return;
  const g = groups();
  const me = meId();
  const items = order(g).map(id => {
    const m = memberOf(id);
    const list = g.get(id) || [];
    const own = id === me;
    const cls = own && upload ? 'up' : list.length ? (list.some(s => !isSeen(s)) ? 'new' : 'seen') : 'none';
    const label = own ? t('st.yours') : esc(m.first);
    const aria = own ? (list.length ? t('st.openMine') : t('st.new')) : list.length ? t('st.openOf', { name: esc(m.first) }) : t('st.profileOf', { name: esc(m.first) });
    return `<button class="st-item ${cls}${own ? ' own' : ''}" data-action="story-open" data-id="${esc(id)}" aria-label="${aria}">
      <span class="st-ring"${own && upload ? ` style="--p:${Math.round(upload.p * 100)}%"` : ''}><span class="st-face">${avatar(m, 56, { flagged: false })}</span></span>
      ${own ? `<span class="st-plus" data-action="story-new" aria-hidden="true">${icon('plus', 13)}</span>` : ''}
      <span class="st-name">${label}</span></button>`;
  });
  if (!me) items.unshift(`<button class="st-item none add" data-action="story-new" aria-label="${esc(t('st.new'))}">
      <span class="st-ring"><span class="st-face st-blank">${icon('plus', 24)}</span></span><span class="st-name">${t('st.yours')}</span></button>`);
  const html = items.join('');
  if (html !== railHtml) { railHtml = html; host.innerHTML = html; }
}

/** Upload progress on your own avatar (null when done). */
export function setUpload(p) {
  upload = p == null ? null : { p };
  const ring = $('#rail .st-item.own .st-ring');
  if (ring && upload && ring.parentElement.classList.contains('up')) ring.style.setProperty('--p', `${Math.round(upload.p * 100)}%`);
  else renderRail();
}

/** Called with every new view of the ledger: rail, live viewer and "Ana posted a story" toasts. */
export function onData(data) {
  const list = (data && data.stories) || [];
  const me = meId();
  if (prevStories && me) {
    const fresh = list.filter(s => !prevStories.has(s.id) && s.m !== me && s.at > now() - STORY.TTL);
    const mention = fresh.find(s => (s.mn || []).includes(me));
    if (mention) toast(t('st.mentioned', { name: firstName(mention.m) }), { type: 'good', duration: 5000, action: { label: t('st.watch'), run: () => openViewer(mention.m) } });
    else if (fresh.length === 1) toast(t('st.posted', { name: firstName(fresh[0].m) }), { duration: 4500, action: { label: t('st.watch'), run: () => openViewer(fresh[0].m) } });
    else if (fresh.length > 1) toast(t('st.postedMany', { n: fresh.length }), { duration: 4500 });
    for (const s of list.filter(x => x.m === me)) {
      const was = prevStories.get(s.id);
      if (!was) continue;
      const rep = s.replies.slice(was.p).filter(r => r.m !== me).pop();
      const rea = s.reacts.slice(was.r).filter(r => r.m !== me).pop();
      if (rep) toast(t('st.replied', { name: firstName(rep.m), text: rep.x }), { duration: 5000 });
      else if (rea) toast(t('st.reacted', { name: firstName(rea.m), e: rea.e }), { duration: 4000 });
    }
  }
  prevStories = new Map(list.map(s => [s.id, { r: s.reacts.length, p: s.replies.length }]));
  renderRail();
  if (V) refreshViewer();
}
const firstName = id => { const m = memberOf(id); return m ? m.first : id; };

/** Tap on an avatar in the rail. */
export function railTap(id) {
  const g = groups();
  if (g.has(id)) return openViewer(id);
  if (id === meId()) return app.compose();
  app.openMember(id);
}

/* ═════════════ Viewer ═════════════ */
let V = null;
const cur = () => V && (groups().get(V.ids[V.mi]) || [])[V.si];

export function openViewer(mid) {
  const g = groups();
  if (!g.has(mid)) return;
  let pushed = false;
  if (V) { pushed = V.pushed; V.pushed = false; closeViewer(true); } // reuse its history entry
  const el = document.createElement('div');
  el.className = 'sv';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', t('st.viewer'));
  el.innerHTML = `<div class="sv-scene"><div class="sv-cube"></div></div>`;
  document.body.appendChild(el);
  lockScroll();
  const video = document.createElement('video');
  video.className = 'sv-vid';
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.preload = 'auto';
  video.addEventListener('ended', () => V && V.video === video && next());
  video.play().catch(() => {}); // inside the tap: lets this element play with sound later (iOS)
  video.addEventListener('waiting', () => V && pause('buffer'));
  video.addEventListener('playing', () => V && resume('buffer'));
  video.addEventListener('error', () => { // a format this phone can't play: show the error card and move on
    if (!V || V.video !== video || (cur() || {}).k !== 'video') return;
    const m = V.face.querySelector('.sv-media');
    m.classList.remove('loading'); m.classList.add('failed');
    V.pauses.delete('buffer'); V.ready = true; V.elapsed = IMAGE_MS - 2200;
  });
  const ids = order(g).filter(id => g.has(id));
  V = { el, scene: el.querySelector('.sv-scene'), cube: el.querySelector('.sv-cube'), ids, mi: ids.indexOf(mid), si: firstUnseen(g.get(mid)),
    video, muted: false, pauses: new Set(), token: 0, prog: 0, elapsed: 0, last: 0, ready: false, raf: 0, pushed, busy: false };
  V.face = face(mid, 0);
  V.cube.appendChild(V.face);
  measure();
  bind();
  if (!V.pushed) try { history.pushState({ sv: 1 }, ''); V.pushed = true; } catch { /* sandboxed */ }
  requestAnimationFrame(() => el.classList.add('in'));
  V.raf = requestAnimationFrame(loop);
  show();
}

export function closeViewer(immediate = false) {
  if (!V) return;
  const v = V;
  V = null;
  cancelAnimationFrame(v.raf);
  v.video.pause();
  v.video.removeAttribute('src');
  try { v.video.load(); } catch { /* ignore */ }
  unlockScroll();
  flushSeen();
  if (v.pushed) { v.pushed = false; try { history.back(); } catch { /* ignore */ } }
  renderRail();
  if (immediate || reducedMotion()) return v.el.remove();
  v.el.classList.remove('in');
  v.el.classList.add('out');
  setTimeout(() => v.el.remove(), 280);
}

function measure() {
  if (!V) return;
  V.w = V.scene.clientWidth || innerWidth;
  V.cube.style.setProperty('--half', `${V.w / 2}px`);
}

function face(mid, angle) {
  const m = memberOf(mid) || { name: mid, first: mid, id: mid };
  const f = document.createElement('section');
  f.className = 'sv-face';
  f.dataset.m = mid;
  f.style.setProperty('--face', `${angle}deg`);
  f.innerHTML = `
    <div class="sv-media"><img class="sv-img" alt="" hidden><div class="sv-spin" aria-hidden="true"></div>
      <p class="sv-fail">${icon('info', 28)}<span>${t('st.unavailable')}</span></p></div>
    <div class="sv-top">
      <div class="sv-bars"></div>
      <div class="sv-head">
        <button class="sv-who" data-sv="profile" aria-label="${esc(m.name)}">${avatar(m, 34, { flagged: false })}<b>${esc(m.first)}</b><span class="sv-time"></span></button>
        <span class="sv-sp"></span>
        <button class="sv-btn sv-mute" data-sv="mute" hidden></button>
        <button class="sv-btn sv-more" data-sv="more" hidden aria-label="${esc(t('st.options'))}">${icon('more', 24)}</button>
        <button class="sv-btn" data-sv="close" aria-label="${esc(t('common.close'))}">${icon('close', 26)}</button>
      </div>
    </div>
    <div class="sv-bottom"></div>`;
  return f;
}

function bars(f, list) {
  const host = f.querySelector('.sv-bars');
  if (host.children.length !== list.length) host.innerHTML = list.map(() => '<i><b></b></i>').join('');
  [...host.children].forEach((el, k) => {
    el.className = k < V.si ? 'done' : '';
    el.firstChild.style.transform = `scaleX(${k < V.si ? 1 : 0})`;
  });
}

const shortAgo = at => { const s = now() - at; return s < 60 ? t('st.ago.now') : s < 3600 ? t('st.ago.min', { n: Math.floor(s / 60) }) : t('st.ago.h', { n: Math.floor(s / 3600) }); };

function bottom(f, s) {
  const me = meId();
  const host = f.querySelector('.sv-bottom');
  if (s.m === me) {
    const viewers = Object.keys(s.views || {}).filter(id => memberOf(id)).sort((a, b) => s.views[b] - s.views[a]);
    const hearts = s.reacts.length + s.replies.length;
    host.innerHTML = `<button class="sv-act" data-sv="activity">
      <span class="sv-faces">${viewers.slice(0, 3).map(id => avatar(memberOf(id), 26, { flagged: false })).join('')}</span>
      <span>${viewers.length ? t('st.seenBy', { n: viewers.length }) : t('st.noViews')}</span>${hearts ? `<span class="sv-act-n">${icon('heart', 15)} ${hearts}</span>` : ''}
      ${icon('chevron', 16, 'sv-act-up')}</button>`;
  } else if (me) {
    const liked = s.reacts.some(r => r.m === me && r.e === '❤️');
    host.innerHTML = `<form class="sv-reply" data-sv-form>
      <input type="text" enterkeyhint="send" maxlength="300" autocomplete="off" placeholder="${esc(t('st.replyTo', { name: firstName(s.m) }))}" aria-label="${esc(t('st.reply'))}">
      <button type="button" class="sv-btn sv-like ${liked ? 'on' : ''}" data-sv="like" aria-label="${esc(t('st.like'))}">${icon('heart', 26)}</button>
      <button type="submit" class="sv-btn sv-send" aria-label="${esc(t('st.send'))}">${icon('send', 24)}</button>
    </form>
    <div class="sv-quick" hidden>${STORY.REACTIONS.map(e => `<button type="button" data-sv="react" data-e="${e}">${e}</button>`).join('')}</div>`;
  } else {
    host.innerHTML = `<button class="sv-act ghost" data-sv="signin">${t('st.signinToReply')}</button>`;
  }
}

async function show() {
  if (!V) return;
  const list = groups().get(V.ids[V.mi]) || [];
  if (!list.length) return nextMember() || closeViewer();
  V.si = Math.max(0, Math.min(V.si, list.length - 1));
  const s = list[V.si];
  const token = ++V.token;
  const f = V.face;
  f.dataset.sid = s.id;
  V.ready = false; V.elapsed = 0; V.prog = 0; V.last = 0;
  bars(f, list);
  f.querySelector('.sv-time').textContent = shortAgo(s.at);
  const captain = (app.state.data.admins || []).includes(meId());
  f.querySelector('.sv-more').hidden = !(s.m === meId() || captain);
  const mute = f.querySelector('.sv-mute');
  mute.hidden = s.k !== 'video';
  mute.innerHTML = icon(V.muted ? 'muted' : 'sound', 24);
  bottom(f, s);
  const media = f.querySelector('.sv-media');
  const img = f.querySelector('.sv-img');
  media.style.setProperty('--sbg', s.bg || '#1b2030');
  media.classList.remove('failed');
  media.classList.add('loading');
  media.setAttribute('aria-label', s.x || t(s.k === 'video' ? 'st.videoOf' : 'st.photoOf', { name: firstName(s.m) }));
  V.video.pause();
  try {
    const url = await api.storyMediaUrl(s);
    if (!V || token !== V.token) return;
    if (s.k === 'video') {
      img.hidden = true;
      if (V.video.parentElement !== media) media.appendChild(V.video);
      V.video.hidden = false;
      if (V.video.src !== url) V.video.src = url;
      V.video.currentTime = 0;
      V.video.muted = V.muted;
      await playVideo();
      if (!V || token !== V.token) return;
    } else {
      V.video.hidden = true;
      img.src = url;
      await img.decode().catch(() => {});
      if (!V || token !== V.token) return;
      img.hidden = false;
    }
    media.classList.remove('loading');
    V.ready = true;
    markSeen(s);
    preload(list);
  } catch (e) {
    console.warn('story media', s.id, e);
    if (!V || token !== V.token) return;
    media.classList.remove('loading');
    media.classList.add('failed');
    V.ready = true;
    V.elapsed = IMAGE_MS - 2200;
  }
}

async function playVideo() {
  if (!V || V.pauses.size) return;
  try { await V.video.play(); } catch {
    V.muted = true; V.video.muted = true;
    const b = V.face.querySelector('.sv-mute');
    if (b) b.innerHTML = icon('muted', 24);
    try { await V.video.play(); } catch { /* shown paused; tap resumes */ }
  }
}

function preload(list) {
  const nextOne = list[V.si + 1] || (() => { const g = groups(); const id = V.ids[V.mi + 1]; return id && g.get(id) && g.get(id)[firstUnseen(g.get(id))]; })();
  if (nextOne) api.storyMediaUrl(nextOne).catch(() => {});
}

function loop(ts) {
  if (!V) return;
  const dt = V.last ? Math.min(100, ts - V.last) : 0;
  V.last = ts;
  const s = cur();
  if (s && V.ready && !V.pauses.size && !V.busy) {
    if (s.k === 'video' && !V.face.querySelector('.sv-media').classList.contains('failed')) {
      const d = Number.isFinite(V.video.duration) && V.video.duration > 0 ? V.video.duration : s.du || STORY.MAX_SECONDS;
      V.prog = V.video.currentTime / d;
    } else {
      V.elapsed += dt;
      V.prog = V.elapsed / IMAGE_MS;
      if (V.prog >= 1) { V.raf = requestAnimationFrame(loop); next(); return; }
    }
    const b = V.face.querySelectorAll('.sv-bars b')[V.si];
    if (b) b.style.transform = `scaleX(${Math.min(1, V.prog)})`;
  }
  V.raf = requestAnimationFrame(loop);
}

function pause(why) {
  if (!V) return;
  V.pauses.add(why);
  if (why !== 'buffer') V.video.pause();
}
function resume(why) {
  if (!V) return;
  V.pauses.delete(why);
  if (!V.pauses.size && V.ready && (cur() || {}).k === 'video' && V.video.paused && !V.video.ended) playVideo();
}

function next() {
  if (!V || V.busy) return;
  const list = groups().get(V.ids[V.mi]) || [];
  if (V.si < list.length - 1) { V.si++; show(); return; }
  if (!nextMember()) closeViewer();
}
function prev() {
  if (!V || V.busy) return;
  if (V.si > 0) { V.si--; show(); return; }
  if (!prevMember()) { V.elapsed = 0; show(); }
}
const nextMember = () => turn(1);
const prevMember = () => turn(-1);

/** Cube turn to the next (dir 1) or previous (-1) person; false when there is nobody there. */
function turn(dir, fromDrag = 0) {
  if (!V) return false;
  const mi = V.mi + dir;
  if (mi < 0 || mi >= V.ids.length) return false;
  const g = groups();
  if (!g.has(V.ids[mi])) { V.ids.splice(mi, 1); if (dir < 0) V.mi--; return turn(dir, fromDrag); }
  V.busy = true;
  V.video.pause();
  const nf = neighbour(dir);
  const done = () => {
    if (!V) return;
    V.cube.classList.remove('turning');
    V.face.remove();
    nf.style.setProperty('--face', '0deg');
    V.cube.style.setProperty('--rot', '0deg');
    V.face = nf;
    V.neighbour = null;
    V.mi = mi;
    V.si = firstUnseen(g.get(V.ids[mi]));
    V.busy = false;
    show();
  };
  if (reducedMotion()) { done(); return true; }
  V.cube.style.setProperty('--rot', `${fromDrag}deg`);
  void V.cube.offsetWidth;
  V.cube.classList.add('turning');
  V.cube.style.setProperty('--rot', `${-90 * dir}deg`);
  let fired = false;
  const end = () => { if (!fired) { fired = true; done(); } };
  V.cube.addEventListener('transitionend', end, { once: true });
  setTimeout(end, 520);
  return true;
}

function neighbour(dir) {
  if (V.neighbour && V.neighbour.dir === dir) return V.neighbour.el;
  if (V.neighbour) V.neighbour.el.remove();
  const id = V.ids[V.mi + dir];
  const f = face(id, 90 * dir);
  const g = groups().get(id) || [];
  const s = g[firstUnseen(g)];
  if (s) {
    f.querySelector('.sv-bars').innerHTML = g.map(() => '<i><b></b></i>').join('');
    f.querySelector('.sv-media').style.setProperty('--sbg', s.bg || '#1b2030');
    api.storyMediaUrl(s).then(url => { if (s.k !== 'video') { const img = f.querySelector('.sv-img'); img.src = url; img.hidden = false; } }).catch(() => {});
  }
  V.cube.appendChild(f);
  V.neighbour = { dir, el: f };
  return f;
}

function refreshViewer() {
  if (V.busy) return;
  const list = groups().get(V.ids[V.mi]) || [];
  if (!list.length) { if (!nextMember()) closeViewer(); return; }
  const i = list.findIndex(x => x.id === V.face.dataset.sid);
  if (i < 0) { show(); return; } // the story on screen was deleted
  V.si = i;
  const s = list[i];
  if (V.face.querySelector('.sv-bars').children.length !== list.length) bars(V.face, list);
  if (s.m === meId()) bottom(V.face, s);
  const sheet = V.el.querySelector('.sv-sheet:not(.menu)');
  if (sheet && sheet.dataset.sid === s.id) sheet.querySelector('.sv-sheet-body').innerHTML = activityHtml(s);
}

/* ── Gestures & buttons ── */
function bind() {
  const el = V.el;
  let g = null, holdTimer = 0;
  el.addEventListener('pointerdown', e => {
    if (!V || V.busy || e.button > 0 || e.target.closest('button, input, form, .sv-sheet, .sv-quick') || g) return;
    if (el.classList.contains('typing')) { document.activeElement.blur(); return; } // first tap just closes the keyboard
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), mode: '' };
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    holdTimer = setTimeout(() => { if (g && !g.mode) { g.mode = 'hold'; pause('hold'); el.classList.add('holding'); } }, 230);
  });
  el.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id || !V) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if ((!g.mode || g.mode === 'hold') && Math.hypot(dx, dy) > 12) {
      clearTimeout(holdTimer);
      const wasHold = g.mode === 'hold';
      g.mode = Math.abs(dx) > Math.abs(dy) ? (wasHold ? 'hold' : 'cube') : dy > 0 ? 'down' : 'up';
      if (g.mode === 'cube') { pause('drag'); el.classList.add('dragging'); }
      if (g.mode === 'down') { pause('drag'); el.classList.add('dragging'); }
    }
    if (g.mode === 'cube') {
      const dir = dx < 0 ? 1 : -1;
      const has = V.mi + dir >= 0 && V.mi + dir < V.ids.length;
      if (has) neighbour(dir);
      const rot = (dx / V.w) * 90 * (has ? 1 : 0.2);
      g.rot = Math.max(-90, Math.min(90, rot));
      V.cube.style.setProperty('--rot', `${g.rot}deg`);
    } else if (g.mode === 'down') {
      const y = Math.max(0, dy);
      el.style.setProperty('--drag', `${y}px`);
      el.style.setProperty('--drag-k', String(1 - Math.min(0.3, y / innerHeight / 2)));
    }
  });
  const end = e => {
    if (!g || (e && e.pointerId !== g.id) || !V) return;
    clearTimeout(holdTimer);
    const dx = e ? e.clientX - g.x0 : 0, dy = e ? e.clientY - g.y0 : 0, dt = performance.now() - g.t0;
    const mode = g.mode;
    g = null;
    el.classList.remove('holding', 'dragging');
    if (mode === 'hold') return resume('hold');
    if (mode === 'cube') {
      resume('drag');
      const flick = Math.abs(dx) / Math.max(1, dt) > 0.5;
      const dir = dx < 0 ? 1 : -1;
      if ((Math.abs(dx) > V.w * 0.28 || flick) && turn(dir, (dx / V.w) * 90)) return;
      V.cube.classList.add('turning');
      V.cube.style.setProperty('--rot', '0deg');
      setTimeout(() => V && V.cube.classList.remove('turning'), 320);
      return;
    }
    if (mode === 'down') {
      resume('drag');
      if (dy > 110) return closeViewer();
      el.classList.add('settle');
      el.style.setProperty('--drag', '0px');
      el.style.setProperty('--drag-k', '1');
      setTimeout(() => el.classList.remove('settle'), 300);
      return;
    }
    if (mode === 'up') {
      if (dy < -70) swipeUp();
      return;
    }
    if (dt < 400) {
      const r = V.scene.getBoundingClientRect();
      if (e.clientX - r.left < r.width * 0.3) prev(); else next();
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => { if (g) { const mode = g.mode; g = null; el.classList.remove('holding', 'dragging'); resume('hold'); resume('drag'); if (mode === 'cube') { V.cube.classList.add('turning'); V.cube.style.setProperty('--rot', '0deg'); } } });
  el.addEventListener('contextmenu', e => e.preventDefault());

  el.addEventListener('click', e => {
    const b = e.target.closest('[data-sv]');
    if (!b || !V) return;
    const s = cur();
    const k = b.dataset.sv;
    if (k === 'close') closeViewer();
    else if (k === 'mute') { V.muted = !V.muted; V.video.muted = V.muted; b.innerHTML = icon(V.muted ? 'muted' : 'sound', 24); if (!V.muted) playVideo(); }
    else if (k === 'profile') { const id = V.ids[V.mi]; closeViewer(true); app.openMember(id); }
    else if (k === 'more' && s) openMenu(s);
    else if (k === 'activity' && s) openActivity(s);
    else if (k === 'like' && s) sendReaction(s, '❤️', b);
    else if (k === 'react' && s) { sendReaction(s, b.dataset.e, b); const inp = V.el.querySelector('.sv-reply input'); if (inp) inp.blur(); }
    else if (k === 'signin') { closeViewer(true); app.signin(); }
    else if (k === 'sheet-close') closeSheetIn();
    else if (k === 'delete' && s) removeStory(s);
  });
  el.addEventListener('focusin', e => {
    if (!e.target.matches('.sv-reply input')) return;
    pause('input');
    el.classList.add('typing');
    const q = el.querySelector('.sv-quick'); if (q) q.hidden = false;
  });
  el.addEventListener('focusout', e => {
    if (!e.target.matches('.sv-reply input')) return;
    setTimeout(() => {
      if (!V || V.el.contains(document.activeElement) && document.activeElement.matches('.sv-reply input')) return;
      el.classList.remove('typing');
      const q = el.querySelector('.sv-quick'); if (q) q.hidden = true;
      resume('input');
    }, 180);
  });
  el.addEventListener('input', e => { if (e.target.matches('.sv-reply input')) el.classList.toggle('has-text', !!e.target.value.trim()); });
  el.addEventListener('submit', e => {
    e.preventDefault();
    const inp = e.target.querySelector('input');
    const s = cur();
    const x = inp.value.trim();
    if (!s || !x) return;
    inp.value = '';
    el.classList.remove('has-text');
    inp.blur();
    api.reply(meId(), s.id, x).then(() => { toast(t('st.replySent'), { type: 'good' }); app.changed(); }).catch(() => toast(t('err.requestFailed'), { type: 'warn' }));
  });
}

function swipeUp() {
  const s = cur();
  if (!s) return;
  if (s.m === meId()) openActivity(s);
  else { const inp = V.el.querySelector('.sv-reply input'); if (inp) inp.focus(); }
}

function sendReaction(s, e, btn) {
  const me = meId();
  if (!me) return;
  burst(e, btn);
  if (e === '❤️') btn.classList.add('on');
  if (navigator.vibrate) navigator.vibrate(12);
  api.react(me, s.id, e).then(() => app.changed()).catch(() => toast(t('err.requestFailed'), { type: 'warn' }));
}

function burst(e, from) {
  if (reducedMotion() || !V) return;
  const r = from.getBoundingClientRect();
  for (let k = 0; k < 7; k++) {
    const p = document.createElement('span');
    p.className = 'sv-burst';
    p.textContent = e;
    p.style.left = `${r.left + r.width / 2}px`;
    p.style.top = `${r.top}px`;
    p.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
    p.style.setProperty('--dy', `${-180 - Math.random() * 220}px`);
    p.style.animationDelay = `${k * 45}ms`;
    V.el.appendChild(p);
    setTimeout(() => p.remove(), 1500);
  }
}

/* ── Activity (your story: who saw it, reactions, replies) & menu ── */
function activityHtml(s) {
  const viewers = Object.keys(s.views || {}).filter(id => memberOf(id)).sort((a, b) => s.views[b] - s.views[a]);
  const reactsOf = id => s.reacts.filter(r => r.m === id).map(r => r.e);
  const rows = viewers.map(id => {
    const m = memberOf(id);
    const re = [...new Set(reactsOf(id))].join(' ');
    return `<li>${avatar(m, 40, { flagged: false })}<span><b>${esc(m.name)}</b><small>${ago(new Date(s.views[id] * 1000).toISOString())}</small></span><em>${re}</em></li>`;
  }).join('');
  const replies = s.replies.slice().reverse().map(r => {
    const m = memberOf(r.m);
    return m ? `<li class="rep">${avatar(m, 32, { flagged: false })}<span><b>${esc(m.first)}</b><q>${esc(r.x)}</q><small>${ago(new Date(r.at * 1000).toISOString())}</small></span></li>` : '';
  }).join('');
  return `${replies ? `<p class="sv-sheet-h">${t('st.replies')}</p><ul class="sv-list">${replies}</ul>` : ''}
    <p class="sv-sheet-h">${viewers.length ? t('st.seenBy', { n: viewers.length }) : t('st.noViews')}</p>
    ${rows ? `<ul class="sv-list">${rows}</ul>` : `<p class="sv-empty">${t('st.noViewsYet')}</p>`}
    <button class="sv-del" data-sv="delete">${icon('trash', 18)} ${t('st.delete')}</button>`;
}

function openActivity(s) {
  closeSheetIn();
  pause('sheet');
  const sh = document.createElement('div');
  sh.className = 'sv-sheet';
  sh.dataset.sid = s.id;
  sh.innerHTML = `<div class="sv-sheet-bg" data-sv="sheet-close"></div><div class="sv-sheet-card" role="dialog" aria-label="${esc(t('st.activity'))}">
    <div class="sv-sheet-top"><b>${t('st.activity')}</b><button class="sv-btn" data-sv="sheet-close" aria-label="${esc(t('common.close'))}">${icon('close', 22)}</button></div>
    <div class="sv-sheet-body">${activityHtml(s)}</div></div>`;
  V.el.appendChild(sh);
  requestAnimationFrame(() => sh.classList.add('in'));
}

function openMenu(s) {
  closeSheetIn();
  pause('sheet');
  const sh = document.createElement('div');
  sh.className = 'sv-sheet menu';
  sh.dataset.sid = s.id;
  sh.innerHTML = `<div class="sv-sheet-bg" data-sv="sheet-close"></div><div class="sv-sheet-card">
    <button class="sv-menu-item danger" data-sv="delete">${icon('trash', 20)} ${t('st.delete')}</button>
    <button class="sv-menu-item" data-sv="sheet-close">${t('st.cancel')}</button></div>`;
  V.el.appendChild(sh);
  requestAnimationFrame(() => sh.classList.add('in'));
}

function closeSheetIn() {
  if (!V) return;
  const sh = V.el.querySelector('.sv-sheet');
  if (!sh) return;
  sh.classList.remove('in');
  setTimeout(() => sh.remove(), 240);
  resume('sheet');
}

async function removeStory(s) {
  if (!confirm(t('st.deleteConfirm'))) return;
  closeSheetIn();
  try {
    await api.deleteStory(s.m, s.id);
    toast(t('st.deleted'), { type: 'good' });
    app.changed();
  } catch { toast(t('err.requestFailed'), { type: 'warn' }); }
}
