// Team 8 · Step Challenge — app shell: state, routing, data refresh and user flows.
import { CONFIG } from './config.js';
import * as api from './api.js';
import * as M from './metrics.js';
import * as V from './views.js';
import { t, tn, lang, setLang, langChosen, locale } from './i18n.js';
import { AVATARS, avatarImg, avatarLabel } from './avatars.js';
import { codeOf } from './ledger.js';
import { $, $$, esc, fmt, dec, compact, dateLabel, ago, avatar, avColor, icon, toast, openSheet, closeSheet, sheetBody, countUp, confetti, copyText } from './ui.js';

const { store } = api;
const LS = { me: 't8:me', waiting: 't8:waiting', profile: 't8:profile', theme: 't8:theme', welcomed: 't8:welcomed', installHidden: 't8:install-hidden' };
const ROUTES = ['team', 'ranking', 'me', 'sync', 'settings'];

const state = {
  data: null, model: null, sig: '',
  route: 'team',
  me: store.get(LS.me),                       // { id } — valid while this device's key is one of the member's keys
  kid: '',                                    // this device's key id
  waiting: store.get(LS.waiting),             // { id } — sign-in request waiting for approval
  approvals: [],                              // [{ m, r }] requests this device may approve
  syncBusy: false,
  profile: store.get(LS.profile, { units: 'metric' }),
  theme: store.get(LS.theme, 'auto'),
  installHidden: store.get(LS.installHidden, false),
  rankBy: 'total', teamChart: 'daily', tables: {},
  platform: V.isAndroid() ? 'android' : 'ios',
  loading: false, lastFetch: 0, pending: api.pendingCount(),
  canInstall: false, installEvent: null, animate: true,
  onMember: id => openMember(id),
};

/* ═════════════ Rendering ═════════════ */
const viewEl = $('#view');
const drawers = new WeakMap();
const ro = new ResizeObserver(entries => entries.forEach(e => {
  const w = Math.round(e.contentRect.width);
  if (w && e.target._w !== w) { e.target._w = w; const fn = drawers.get(e.target); fn && fn(); }
}));
const mount = (host, fn) => { drawers.set(host, fn); host._w = Math.round(host.clientWidth); fn(); ro.observe(host); };

function render() {
  if (!state.model) return;
  ro.disconnect();
  const view = { team: V.viewTeam, ranking: V.viewRanking, me: V.viewMe, sync: V.viewSync, settings: V.viewSettings }[state.route];
  viewEl.innerHTML = view(state);
  V.drawPage(state, viewEl, mount);
  if (state.animate) { countUp(viewEl); state.animate = false; }
  renderChrome();
}

function renderChrome() {
  $$('.nav a[data-route]').forEach(a => a.classList.toggle('on', a.dataset.route === state.route));
  $$('.nav a[data-route]').forEach(a => a.setAttribute('aria-current', a.dataset.route === state.route ? 'page' : 'false'));
  $('#settings-btn').classList.toggle('on', state.route === 'settings');
  const ctx = state.model && state.model.ctx;
  $('#day-chip').textContent = !ctx ? '' : ctx.status === 'live' ? t('chip.day', { n: ctx.dayNumber, N: ctx.N }) : ctx.status === 'upcoming' ? t('chip.in', { n: ctx.daysToStart }) : t('chip.finished');
  const btn = $('#refresh-btn');
  btn.classList.toggle('spin', state.loading);
  btn.classList.toggle('offline', !navigator.onLine);
  btn.title = navigator.onLine ? t('top.updated', { ago: ago(state.data && state.data.updatedAt) }) : t('top.offline');
}

/** Static shell text (index.html) follows the chosen language too. */
function applyLang() {
  document.documentElement.lang = locale();
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  $$('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
}

function rebuild() {
  if (!state.data) return;
  if (state.me && !state.data.members.some(m => m.id === state.me.id)) { state.me = null; store.del(LS.me); }
  state.model = M.buildModel(state.data, api.today(), state.profile, state.me && state.me.id);
}

function setData(data, { force = false } = {}) {
  const sig = api.today() + JSON.stringify(data.members.map(m => [m.id, m.daily, m.joined, m.autoSyncs, m.lastSyncAt, m.avatar,
    (m.keys || []).map(k => k.kid), (m.requests || []).map(r => r.kid), m.syncHash]));
  state.data = data;
  state.pending = api.pendingCount();
  checkIdentity();
  if (!force && sig === state.sig && state.model) return renderChrome();
  state.sig = sig;
  rebuild();
  render();
}

/* ═════════════ Identity: this device's key in the ledger ═════════════ */
const later = fn => setTimeout(fn, 0);
const firstName = m => String((m && m.name) || '').split(/\s+/)[0];
const memberOf = id => state.data && state.data.members.find(m => m.id === id);
const hasKey = (m, list = 'keys') => !!(m && state.kid && (m[list] || []).some(k => k.kid === state.kid));
const openSheetKind = () => { const b = sheetBody(); return b && b.firstElementChild ? b.firstElementChild.dataset.sheet : ''; };
const captainName = () => firstName(memberOf(((state.data && state.data.admins) || CONFIG.ADMINS)[0])) || 'Eron';
const errText = e => (e && e.network ? t('err.offline') : t('err.requestFailed'));
const prompted = new Set(); // request ids already shown in the approvals sheet this session

function setMe(id) { state.me = id ? { id } : null; if (id) store.set(LS.me, state.me); else store.del(LS.me); }
function setWaiting(id) { state.waiting = id ? { id } : null; if (id) store.set(LS.waiting, state.waiting); else store.del(LS.waiting); }

/** Reacts to ledger changes that concern this device: approvals, remote sign-outs, requests to review. */
function checkIdentity() {
  const d = state.data;
  if (!d || !state.kid || !d.members.length || !('keys' in d.members[0])) return; // fallback roster has no keys yet
  if (state.waiting) {
    const m = memberOf(state.waiting.id);
    if (hasKey(m)) {
      setMe(m.id); setWaiting(null);
      later(() => { if (openSheetKind() === 'wait') closeSheet(); toast(t('toast.welcomeBack', { name: firstName(m) }), { type: 'good' }); confetti({ count: 60 }); });
    } else if (d.live && !hasKey(m, 'requests')) {
      setWaiting(null);
      later(() => { if (openSheetKind() === 'wait') closeSheet(); toast(t('wait.denied'), { type: 'warn', duration: 5000 }); });
    }
  }
  if (state.me && d.live && !d.demo && !hasKey(memberOf(state.me.id))) {
    setMe(null);
    later(() => toast(t('toast.signedOutRemote'), { type: 'warn', duration: 5000 }));
  }
  const mine = state.me && memberOf(state.me.id);
  const captain = !!mine && (d.admins || []).includes(mine.id);
  state.approvals = !mine ? [] : d.members.filter(m => captain || m.id === mine.id).flatMap(m => (m.requests || []).map(r => ({ m, r })));
  const fresh = state.approvals.filter(a => !prompted.has(a.r.kid));
  if (fresh.length) {
    fresh.forEach(a => prompted.add(a.r.kid));
    later(() => { if (!sheetBody()) openApprovals(); });
  }
  if (openSheetKind() === 'approvals') later(refreshApprovals); // answered elsewhere, cancelled, or a new one
}

function refreshApprovals() {
  const host = sheetBody();
  if (!host || openSheetKind() !== 'approvals') return;
  if (!state.approvals.length) closeSheet();
  else host.querySelector('.req-list').outerHTML = V.requestList(state.approvals);
}

async function refresh({ silent = true } = {}) {
  if (state.loading) return;
  state.loading = true;
  renderChrome();
  try {
    const sent = await api.flushOutbox();
    if (sent) toast(tn('toast.synced', sent), { type: 'good' });
    setData(await api.fetchData());
  } catch (e) {
    if (!silent || !state.data) toast(e.network ? t('toast.offlineData') : e.message, { type: 'warn' });
  } finally {
    state.loading = false;
    state.lastFetch = Date.now();
    renderChrome();
  }
}

/* ═════════════ Routing ═════════════ */
function routeFromHash() {
  const r = (location.hash.match(/^#\/(\w+)/) || [])[1];
  return ROUTES.includes(r) ? r : 'team';
}
addEventListener('hashchange', () => {
  state.route = routeFromHash();
  state.animate = true;
  render();
  scrollTo({ top: 0, behavior: 'instant' });
});

/* ═════════════ Actions (event delegation) ═════════════ */
const SHEETS = { welcome: () => welcomeHtml(), lang: () => langPromptHtml() };

const actions = {
  log: el => openLog({ date: el.dataset.date }),
  member: el => openMember(el.dataset.id),
  signin: () => openSignin(),
  signout: async () => {
    const id = state.me && state.me.id;
    setMe(null); rebuild(); render();
    toast(t('toast.signedOut'));
    if (!id) return;
    await api.signOut(id); // removes this device from the ledger and forgets its key
    state.kid = await api.deviceKid();
    setData(await api.current(), { force: true });
  },
  wait: () => state.waiting && openWaiting(memberOf(state.waiting.id)),
  approvals: () => openApprovals(),
  approve: el => answerRequest(el, true),
  deny: el => answerRequest(el, false),
  'revoke-device': async el => {
    if (!state.me) return;
    try {
      await api.revoke(state.me.id, el.dataset.k);
      setData(await api.current(), { force: true });
      toast(t('toast.revoked'), { type: 'good' });
    } catch (e) { toast(errText(e), { type: 'warn' }); }
  },
  'reset-member': async el => {
    const m = memberOf(el.dataset.id);
    if (!m || !confirm(t('admin.resetConfirm', { name: m.name }))) return;
    try {
      await api.resetMember(m.id);
      setData(await api.current(), { force: true });
      toast(t('toast.reset', { name: firstName(m) }), { type: 'good' });
    } catch (e) { toast(errText(e), { type: 'warn' }); }
  },
  'rank-by': el => { state.rankBy = el.dataset.k; render(); },
  'team-chart': el => { state.teamChart = el.dataset.k; render(); },
  'toggle-table': el => { state.tables[el.dataset.k] = !state.tables[el.dataset.k]; render(); },
  platform: el => { state.platform = el.dataset.k; render(); },
  theme: el => { state.theme = el.dataset.k; store.set(LS.theme, state.theme); applyTheme(); render(); },
  lang: el => {
    const changed = el.dataset.k !== lang();
    setLang(el.dataset.k);
    if (!changed) return;
    applyLang();
    render();
    // Welcome / language sheets re-draw in place so the choice is visible immediately.
    const host = el.closest('.sheet-body');
    const kind = host && host.firstElementChild && host.firstElementChild.dataset.sheet;
    if (kind && SHEETS[kind]) host.innerHTML = SHEETS[kind]();
    else toast(t('toast.lang'), { type: 'good' });
  },
  avatar: () => openAvatarPicker(),
  refresh: () => refresh({ silent: false }),
  'dismiss-install': () => { state.installHidden = true; store.set(LS.installHidden, true); render(); },
  install: () => promptInstall(),
  'copy-sync': () => {
    if (!state.me) return openSignin();
    const link = api.storedSyncLink(state.me.id);
    if (!link) return createSyncLink(false);
    // Copy first, inside the tap (iOS drops clipboard access after an await), then re-register if needed.
    copyText(link).then(ok => toast(ok ? t('toast.linkCopied') : t('toast.copyFail'), { type: ok ? 'good' : 'warn' }));
    api.syncLink(state.me.id, memberOf(state.me.id)).catch(() => {});
  },
  'sync-create': () => createSyncLink(false),
  'sync-new': () => { if (confirm(t('sync.newLinkConfirm'))) createSyncLink(true); },
  'share-app': async () => {
    const ctx = state.model.ctx;
    const data = { title: 'Team 8 Step Challenge', text: t('share.text', { start: dateLabel(ctx.start, 'short'), end: dateLabel(ctx.end, 'short') }), url: CONFIG.APP_URL };
    if (navigator.share) { try { await navigator.share(data); } catch { /* cancelled */ } return; }
    const ok = await copyText(`${data.text} ${data.url}`);
    toast(ok ? t('toast.inviteCopied') : CONFIG.APP_URL);
  },
  ocr: () => openLog({ pickScreenshot: true }),
  'welcome-go': () => { closeSheet(true); openSignin(); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  e.preventDefault();
  actions[el.dataset.action](el, e);
});

document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-form="profile"]');
  if (!form) return;
  e.preventDefault();
  const f = new FormData(form);
  const num = (v, lo, hi) => { const n = Number(v); return n >= lo && n <= hi ? n : null; };
  state.profile = { heightCm: num(f.get('heightCm'), 120, 230), weightKg: num(f.get('weightKg'), 35, 250), units: f.get('units') === 'imperial' ? 'imperial' : 'metric' };
  store.set(LS.profile, state.profile);
  rebuild(); render();
  toast(t('toast.profileSaved'), { type: 'good' });
});

/* ═════════════ Log steps flow ═════════════ */
function openLog({ date, steps, pickScreenshot = false, file = null } = {}) {
  if (!state.model) return;
  if (!state.me) return openSignin({ then: () => openLog({ date, steps, pickScreenshot, file }) });
  const { ctx, me } = state.model;
  if (ctx.status === 'upcoming') return toast(t('toast.startsOn', { date: dateLabel(ctx.start) }));

  const days = ctx.dates.slice(0, ctx.lastIdx + 1).reverse();
  let sel = date && days.includes(date) ? date : days[0];
  const quick = [500, 1000, 2500, 5000];

  const body = openSheet(`
    <div class="log">
      <div class="log-h">${avatar(me, 44)}<div><h2>${t('common.logSteps')}</h2><p class="muted">${esc(me.name)}</p></div></div>
      <div class="date-chips" role="radiogroup" aria-label="${esc(t('log.day'))}">
        ${days.slice(0, 2).map((d, k) => `<button type="button" role="radio" class="chip" data-date="${d}">${ctx.status === 'live' ? t(k === 0 ? 'common.today' : 'common.yesterday') : dateLabel(d, 'short')}</button>`).join('')}
        ${days.length > 2 ? `<label class="chip select"><span>${t('log.otherDay')}</span><select aria-label="${esc(t('log.otherDay'))}">${['<option value="">…</option>', ...days.slice(2).map(d => `<option value="${d}">${dateLabel(d)}</option>`)].join('')}</select></label>` : ''}
      </div>
      <p class="log-current" aria-live="polite"></p>
      <label class="steps-input"><input id="steps-in" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="0" aria-label="${esc(t('log.steps'))}"><span>${t('unit.steps')}</span></label>
      <div class="quick">${quick.map(q => `<button type="button" class="chip" data-add="${q}">+${fmt(q)}</button>`).join('')}<button type="button" class="chip" data-clear>${t('log.clear')}</button></div>
      <div class="ocr-status" hidden></div>
      <div class="btn-row">
        <button type="button" class="btn ghost" data-shot>${icon('camera', 18)} ${t('log.fromShot')}</button>
        <button type="button" class="btn" data-save>${icon('check', 18)} ${t('common.save')}</button>
      </div>
      <input type="file" accept="image/*" data-file hidden>
      <p class="muted sm center">${t('log.tired')} <a href="#/sync" class="link" data-close>${t('log.turnOnAuto')}</a></p>
    </div>`, { label: t('common.logSteps') });

  const input = $('#steps-in', body);
  const current = $('.log-current', body);
  const parse = () => Number(String(input.value).replace(/\D/g, '')) || 0;
  const show = n => { input.value = n ? fmt(n) : ''; };
  const pick = d => {
    sel = d;
    $$('.date-chips .chip[data-date]', body).forEach(c => c.setAttribute('aria-checked', String(c.dataset.date === d)));
    $$('.date-chips .chip[data-date]', body).forEach(c => c.classList.toggle('on', c.dataset.date === d));
    const sl = $('.date-chips select', body);
    if (sl) { sl.value = days.indexOf(d) >= 2 ? d : ''; sl.parentElement.classList.toggle('on', days.indexOf(d) >= 2); }
    const v = me.daily[ctx.dates.indexOf(d)];
    current.innerHTML = v == null ? t('log.nothing', { date: dateLabel(d) }) : t('log.current', { date: dateLabel(d), v: fmt(v) });
    show(v || 0);
  };
  pick(sel);
  if (steps) show(steps);

  input.addEventListener('input', () => { const n = parse(); show(n); });
  body.addEventListener('click', e => {
    const b = e.target.closest('button, a');
    if (!b) return;
    if (b.dataset.date) pick(b.dataset.date);
    else if (b.dataset.add) show(Math.min(100000, parse() + Number(b.dataset.add)));
    else if ('clear' in b.dataset) show(0);
    else if ('shot' in b.dataset) $('[data-file]', body).click();
    else if ('save' in b.dataset) save();
  });
  const sel2 = $('.date-chips select', body);
  if (sel2) sel2.addEventListener('change', () => sel2.value && pick(sel2.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  $('[data-file]', body).addEventListener('change', e => e.target.files[0] && runOcr(e.target.files[0]));
  if (file) runOcr(file);
  else if (pickScreenshot) $('[data-file]', body).click();
  else if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => input.focus(), 250);

  async function runOcr(f) {
    const box = $('.ocr-status', body);
    box.hidden = false;
    box.innerHTML = `<div class="progress"><i style="width:5%"></i></div><span>${t('ocr.loading')}</span>`;
    try {
      const ocr = await import('./ocr.js');
      const res = await ocr.readSteps(f, (p, msg) => {
        box.querySelector('i').style.width = `${Math.round(p * 100)}%`;
        box.querySelector('span').textContent = msg;
      });
      if (res.steps) {
        show(res.steps);
        box.innerHTML = `${t('ocr.found', { v: fmt(res.steps) })}${res.alternatives.length ? `<div class="quick alt">${t('ocr.notRight')} ${res.alternatives.map(a => `<button type="button" class="chip" data-alt="${a}">${fmt(a)}</button>`).join('')}</div>` : ''}`;
        $$('[data-alt]', box).forEach(b => b.addEventListener('click', () => show(Number(b.dataset.alt))));
      } else {
        box.innerHTML = t('ocr.none');
      }
    } catch (err) {
      box.innerHTML = `⚠️ ${esc(err.message || t('ocr.fail'))}`;
    }
  }

  async function save() {
    const n = parse();
    if (n > 100000) return toast(t('toast.tooHigh'), { type: 'warn' });
    const btn = $('[data-save]', body);
    btn.disabled = true;
    btn.classList.add('busy');
    const i = ctx.dates.indexOf(sel);
    const before = me.daily[i];
    const badgesBefore = new Set(me.badges.filter(b => b.earned).map(b => b.id));
    try {
      const res = await api.logSteps({ id: state.me.id, date: sel, steps: n });
      setData(await api.current(), { force: true }); // already live for the whole team
      closeSheet();
      const meNow = state.model.me;
      const newBadges = meNow.badges.filter(b => b.earned && !badgesBefore.has(b.id));
      if (n >= ctx.goal && (before || 0) < ctx.goal) { confetti(); toast(t('toast.goalCrushed', { v: fmt(n) }), { type: 'good' }); }
      else toast(res.queued ? t('toast.savedOffline') : t('toast.saved', { v: fmt(n), date: dateLabel(sel, 'short') }), { type: res.queued ? 'warn' : 'good' });
      newBadges.slice(0, 2).forEach((b, k) => setTimeout(() => toast(t('toast.newBadge', { emoji: b.emoji, name: V.badgeName(b) }), { type: 'badge', duration: 4200 }), 900 + k * 1200));
      if (newBadges.length && !(n >= ctx.goal && (before || 0) < ctx.goal)) setTimeout(() => confetti({ count: 80 }), 900);
      if (res.queued) state.pending = api.pendingCount();
    } catch (err) {
      btn.disabled = false;
      btn.classList.remove('busy');
      toast(errText(err), { type: 'warn' });
    }
  }
}

/* ═════════════ Sign-in flow: name → this device (or a request another device approves) ═════════════ */
function openSignin({ then } = {}) {
  if (!state.model) return;
  if (!state.kid) return toast(t('toast.noCrypto'), { type: 'warn', duration: 5000 });
  if (state.waiting) return openWaiting(memberOf(state.waiting.id));
  const members = state.model.members.slice().sort((a, b) => a.name.localeCompare(b.name));
  const body = openSheet(`
    <div class="signin">
      <h2>${t('signin.title')}</h2>
      <p class="muted">${t('signin.text')}</p>
      <div class="who-grid">${members.map(m => `<button class="who" data-id="${esc(m.id)}">${avatar(m, 52)}<b>${esc(m.first)}</b><small>${hasKey(m) ? t('common.you') : t(m.joined ? 'signin.joined' : 'signin.new')}</small></button>`).join('')}</div>
      <p class="muted sm center">${t('signin.justLooking')}</p>
    </div>`, { label: t('common.signin') });
  body.addEventListener('click', e => {
    const b = e.target.closest('.who');
    if (!b) return;
    const m = state.model.byId[b.dataset.id];
    if (hasKey(m)) { setMe(m.id); rebuild(); render(); closeSheet(); toast(t('toast.welcomeBack', { name: m.first }), { type: 'good' }); return then && then(); }
    if (m.joined) openTaken(m); else openClaim(m, then);
  });
}

/** Free name: one tap links this device to it. */
function openClaim(m, then) {
  const iosBrowser = V.isIOS() && !V.isStandalone();
  const body = openSheet(`
    <div class="claim center-card" data-sheet="claim">
      ${avatar(m, 72)}
      <h2>${t('claim.title', { name: esc(m.first) })}</h2>
      <p class="muted">${t('claim.text')}</p>
      ${iosBrowser ? `<p class="claim-tip">${t('claim.iosTip')}</p>` : ''}
      <button class="btn lg full" data-claim>${icon('check', 18)} ${t('claim.yes')}</button>
      <p class="muted sm">${t('claim.notYou')}</p>
    </div>`, { label: t('common.signin') });
  $('[data-claim]', body).addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.classList.add('busy');
    try {
      const r = await api.claim(m.id);
      setData(r.view, { force: true });
      if (r.status !== 'joined') { setWaiting(m.id); return openWaiting(memberOf(m.id)); } // someone was faster
      setMe(m.id); rebuild(); render();
      closeSheet(true);
      toast(t('toast.welcome', { name: m.first }), { type: 'good' });
      if (then) then(); else openNextSteps();
    } catch (err) {
      btn.disabled = false; btn.classList.remove('busy');
      toast(errText(err), { type: 'warn' });
    }
  });
}

/** Name already linked to another device: ask that device (or the captain) to approve this one. */
function openTaken(m) {
  const body = openSheet(`
    <div class="claim center-card" data-sheet="taken">
      ${avatar(m, 72)}
      <h2>${t('claim.taken', { name: esc(m.first) })}</h2>
      <p class="muted">${t('claim.takenText')}</p>
      <button class="btn lg full" data-request>${icon('phone', 18)} ${t('claim.request')}</button>
      <p class="muted sm">${t('claim.lost', { captain: esc(captainName()) })}</p>
    </div>`, { label: t('common.signin') });
  $('[data-request]', body).addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.classList.add('busy');
    try {
      const r = await api.claim(m.id);
      setWaiting(m.id);
      setData(r.view, { force: true });
      if (state.waiting) { openWaiting(memberOf(m.id)); toast(t('toast.requested'), { type: 'good' }); }
      else closeSheet(); // the name was freed meanwhile: this device got it straight away
    } catch (err) {
      btn.disabled = false; btn.classList.remove('busy');
      toast(errText(err), { type: 'warn' });
    }
  });
}

/** Shown on the new device until one of the member's devices (or the captain) approves it. */
function openWaiting(m) {
  if (!m) return;
  const code = codeOf(state.kid);
  const body = openSheet(`
    <div class="claim center-card" data-sheet="wait">
      ${avatar(m, 72)}
      <h2>${t('wait.title')}</h2>
      <p class="muted">${t('wait.text', { captain: esc(captainName()) })}</p>
      <div class="code" aria-label="${esc(t('req.code'))} ${code}">${[...code].map(c => `<span>${c}</span>`).join('')}</div>
      <p class="muted sm"><span class="live-dot" aria-hidden="true"></span> ${t('wait.live')}</p>
      <button class="btn ghost full" data-cancel>${t('wait.cancel')}</button>
    </div>`, { label: t('wait.title') });
  $('[data-cancel]', body).addEventListener('click', async () => {
    setWaiting(null);
    closeSheet();
    try { await api.deny(m.id, state.kid); setData(await api.current(), { force: true }); } catch { /* the request just expires */ }
  });
}

/** Requests this device may answer (its member's own, or everyone's for the captain). */
function openApprovals() {
  if (!state.approvals.length) return;
  openSheet(`<div class="approvals" data-sheet="approvals">
      <h2>${t('req.title')}</h2>
      <p class="muted">${t('req.text')}</p>
      ${V.requestList(state.approvals)}
    </div>`, { label: t('req.title') });
}

async function answerRequest(el, yes) {
  const m = memberOf(el.dataset.m);
  if (!m || el.disabled) return;
  el.disabled = true;
  try {
    await (yes ? api.approve(m.id, el.dataset.k) : api.deny(m.id, el.dataset.k));
    setData(await api.current(), { force: true }); // also refreshes / closes the approvals sheet
    toast(t(yes ? 'toast.approved' : 'toast.denied'), { type: 'good' });
  } catch (err) {
    el.disabled = false;
    toast(errText(err), { type: 'warn' });
  }
}

/* ═════════════ Auto-sync link ═════════════ */
async function createSyncLink(rotate) {
  if (!state.me || state.syncBusy) return;
  state.syncBusy = true;
  render();
  try {
    await api.syncLink(state.me.id, memberOf(state.me.id), { rotate });
    setData(await api.current(), { force: true });
    toast(t('toast.newLink'), { type: 'good' });
  } catch (err) {
    toast(errText(err), { type: 'warn' });
  } finally {
    state.syncBusy = false;
    render();
  }
}

function openNextSteps() {
  openSheet(`
    <div class="center-card next">
      <div class="big-emoji">🎉</div>
      <h2>${t('next.title')}</h2>
      <p class="muted">${t('next.text')}</p>
      <button class="option" data-action="avatar"><span>🧑‍🎨</span><div><b>${t('avatar.title')}</b><small>${t('next.avatarSub')}</small></div>${icon('chevron', 20)}</button>
      <a class="option" href="#/sync" data-close><span>⚡</span><div><b>${t('next.auto')}</b><small>${t('next.autoSub')}</small></div>${icon('chevron', 20)}</a>
      ${V.isStandalone() ? '' : `<button class="option" data-action="install"><span>📲</span><div><b>${t('next.install')}</b><small>${t('next.installSub')}</small></div>${icon('chevron', 20)}</button>`}
      <button class="option" data-action="log"><span>👟</span><div><b>${t('next.log')}</b><small>${t('next.logSub')}</small></div>${icon('chevron', 20)}</button>
    </div>`, { label: t('next.aria') });
}

/* ═════════════ Avatar picker ═════════════ */
function openAvatarPicker() {
  if (!state.model) return;
  if (!state.me) return openSignin({ then: openAvatarPicker });
  const me = state.model.me;
  if (!me) return;
  const cur = me.avatar || '';
  let group = cur ? cur[0] : 'f';
  const grid = () => AVATARS.filter(a => a.g === group).map(a => {
    const label = avatarLabel(a.id, lang());
    return `<button class="av-opt ${a.id === cur ? 'on' : ''}" data-av="${a.id}" aria-pressed="${a.id === cur}" aria-label="${esc(label)}" title="${esc(label)}" style="--av:${avColor(me)}">${avatarImg(a.id)}</button>`;
  }).join('');
  const tabs = () => ['f', 'm'].map(g => `<button class="chip ${g === group ? 'on' : ''}" role="tab" aria-selected="${g === group}" data-group="${g}">${t(g === 'f' ? 'avatar.female' : 'avatar.male')}</button>`).join('');
  const body = openSheet(`
    <div class="av-pick" data-sheet="avatar">
      <div class="av-pick-h">${avatar(me, 56, { flagged: false })}<div><h2>${t('avatar.title')}</h2><p class="muted">${t('avatar.sub')}</p></div></div>
      <div class="av-tabs" role="tablist" aria-label="${esc(t('avatar.title'))}">${tabs()}</div>
      <div class="av-grid">${grid()}</div>
      <button class="btn ghost full av-none ${cur ? '' : 'on'}" data-av="">${avatar({ ...me, avatar: '' }, 28, { flagged: false })} ${t('avatar.initials')}</button>
    </div>`, { label: t('avatar.title') });

  body.addEventListener('click', async e => {
    const tab = e.target.closest('[data-group]');
    if (tab) {
      group = tab.dataset.group;
      $('.av-tabs', body).innerHTML = tabs();
      $('.av-grid', body).innerHTML = grid();
      return;
    }
    const b = e.target.closest('[data-av]');
    if (!b || body.classList.contains('busy')) return;
    const choice = b.dataset.av;
    if (choice === cur) return closeSheet();
    body.classList.add('busy');
    b.classList.add('saving');
    try {
      await api.setAvatar({ id: state.me.id, avatar: choice });
      setData(await api.current(), { force: true });
      closeSheet();
      toast(t(choice ? 'toast.avatarSaved' : 'toast.avatarCleared'), { type: 'good' });
      if (choice && !cur) confetti({ count: 60 });
    } catch (err) {
      body.classList.remove('busy');
      b.classList.remove('saving');
      toast(errText(err), { type: 'warn' });
    }
  });
}

/* ═════════════ Member detail ═════════════ */
function openMember(id) {
  const m = state.model && state.model.byId[id];
  if (!m) return;
  const s = m.s;
  const earned = m.badges.filter(b => b.earned);
  const isMe = state.me && state.me.id === m.id;
  const body = openSheet(`
    <div class="member">
      <div class="member-h">${isMe ? `<button class="me-av" data-action="avatar" aria-label="${esc(t('avatar.change'))}">${avatar(m, 64)}<span class="me-av-edit" aria-hidden="true">${icon('edit', 12)}</span></button>` : avatar(m, 64)}<div><h2>${esc(m.name)}</h2>
        <p><span class="tag">${s.level.emoji} ${V.levelName(s.level)}</span><span class="tag">${t('me.rankOf', { rank: m.rank, M: state.model.team.M })}</span></p></div></div>
      <div class="member-stats">
        <div><b>${compact(s.total)}</b><small>${t('member.total')}</small></div>
        <div><b>${compact(s.avg)}</b><small>${t('member.avg')}</small></div>
        <div><b>${compact(s.best)}</b><small>${t('member.best')}</small></div>
        <div><b>${s.current}🔥</b><small>${t('member.streak')}</small></div>
      </div>
      <div class="chart" data-member-chart></div>
      <div class="legend"><span><i class="lg-box k-series"></i>${esc(m.first)}</span><span><i class="lg-line k-context"></i>${t('lg.teamAvg')}</span><span><i class="lg-dash"></i>${t('lg.goal10k')}</span></div>
      <p class="mini-h">${t('badges.title', { a: earned.length, b: m.badges.length })}</p>
      <div class="badge-chips">${earned.length ? earned.map(b => `<span class="badge-chip" title="${esc(V.badgeDesc(b))}">${b.emoji} ${esc(V.badgeName(b))}</span>`).join('') : `<span class="muted sm">${t('member.noBadges')}</span>`}</div>
      <p class="muted sm">${m.lastSyncAt ? t('me.lastUpdate', { ago: ago(m.lastSyncAt), src: V.sourceLabel(m.lastSource) }) : t(m.joined ? 'member.joinedNoSteps' : 'member.notJoined')} · ${dec(s.km, 1)} km · ${fmt(s.kcal)} kcal</p>
      ${isMe ? `<button class="btn full" data-action="log">${icon('plus', 18)} ${t('member.logMine')}</button>` : ''}
    </div>`, { label: m.name });
  const host = $('[data-member-chart]', body);
  requestAnimationFrame(() => V.drawMemberChart(state, host, m));
}

/* ═════════════ First run: welcome (with language) or a one-time language prompt ═════════════ */
function welcomeHtml() {
  const ctx = state.model.ctx;
  return `
    <div class="welcome" data-sheet="welcome">
      <div class="welcome-lang">${V.langOptions('lang-row')}</div>
      <div class="welcome-art" aria-hidden="true"><img src="icons/icon.svg" alt="" width="88" height="88"></div>
      <h2>Team 8 Step Challenge</h2>
      <p class="welcome-dates">${t('welcome.dates', { start: dateLabel(ctx.start, 'short'), end: dateLabel(ctx.end, 'short'), N: ctx.N })}</p>
      <p class="welcome-flags">${t('welcome.flags', { M: state.model.team.M })}</p>
      <ul class="welcome-list">
        <li><span>⚡</span><div>${t('welcome.auto')}</div></li>
        <li><span>📊</span><div>${t('welcome.dash')}</div></li>
        <li><span>🏅</span><div>${t('welcome.badges')}</div></li>
      </ul>
      <button class="btn lg full" data-action="welcome-go">${t('welcome.go')}</button>
      <button class="btn ghost full" data-close>${t('welcome.look')}</button>
    </div>`;
}

function openWelcome() {
  openSheet(welcomeHtml(), { label: t('welcome.aria'), cls: 'tall' });
  store.set(LS.welcomed, true);
  setLang(lang()); // the welcome sheet is where the language is chosen — don't ask again later
}

function langPromptHtml() {
  return `
    <div class="center-card lang-prompt" data-sheet="lang">
      <div class="big-emoji">🌐</div>
      <h2>${t('lang.pick')}</h2>
      ${V.langOptions()}
      <button class="btn lg full" data-close>${t('common.continue')}</button>
      <p class="muted sm">${t('lang.later')}</p>
    </div>`;
}

function openLangPrompt() {
  openSheet(langPromptHtml(), { label: t('lang.pick'), onClose: () => setLang(lang()) });
}

/* ═════════════ Install & theme ═════════════ */
addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  state.installEvent = e;
  state.canInstall = true;
  if (state.route === 'sync') render();
});
addEventListener('appinstalled', () => { state.installEvent = null; state.canInstall = false; toast(t('toast.installed'), { type: 'good' }); });

async function promptInstall() {
  if (state.installEvent) {
    state.installEvent.prompt();
    await state.installEvent.userChoice.catch(() => null);
    state.installEvent = null; state.canInstall = false;
    return;
  }
  openSheet(`
    <div class="center-card">
      <div class="big-emoji">📲</div><h2>${t('inst.sheetTitle')}</h2>
      ${V.isIOS() ? `<ol class="steps compact left"><li>${t('inst.ios1')}</li><li>${t('inst.iosShare', { icon: icon('share', 16) })}</li><li>${t('inst.iosAdd')}</li></ol>`
        : `<ol class="steps compact left"><li>${t('inst.and1')}</li><li>${t('inst.andMenu')}</li><li>${t('inst.andInstall')}</li></ol>`}
      <p class="muted sm">${t('inst.note')}</p>
    </div>`, { label: t('common.install') });
}

function applyTheme() {
  const root = document.documentElement;
  if (state.theme === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = state.theme;
  const dark = state.theme === 'dark' || (state.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]').setAttribute('content', dark ? '#0b0f1a' : '#f3f5fa');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

/* ═════════════ Service worker & updates ═════════════ */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const dev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !new URLSearchParams(location.search).has('sw');
  if (dev) return; // local development: always serve fresh files (add ?sw to test offline mode)
  // Reload only when the user accepts an update — the first install also fires controllerchange (clients.claim)
  // and reloading then would close the welcome / sign-in sheet.
  let updating = false;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    const offer = w => toast(t('toast.update'), { duration: 0, action: { label: t('toast.updateBtn'), run: () => { updating = true; w.postMessage('SKIP_WAITING'); } } });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) { updating = false; location.reload(); } });
}

/* Android share target: the service worker stores the shared screenshot, we pick it up here. */
async function takeSharedScreenshot() {
  try {
    const cache = await caches.open('t8-share');
    const res = await cache.match('./__shared-image');
    if (!res) return null;
    await cache.delete('./__shared-image');
    return await res.blob();
  } catch { return null; }
}

/* ═════════════ Boot ═════════════ */
async function boot() {
  applyTheme();
  applyLang();
  state.route = routeFromHash();
  $('#refresh-btn').addEventListener('click', () => refresh({ silent: false }));
  state.kid = await api.deviceKid();

  const cached = api.cachedData();
  if (cached) setData(cached);
  else setData({ challenge: CONFIG.CHALLENGE, members: CONFIG.ROSTER.map(r => ({ ...r, daily: [] })), updatedAt: null });
  document.body.classList.remove('booting');

  await refresh({ silent: !!cached });
  api.live(view => setData(view)); // other people's steps appear within a second

  const params = new URLSearchParams(location.search);
  if (params.has('shared')) {
    history.replaceState(null, '', location.pathname + location.hash);
    const blob = await takeSharedScreenshot();
    if (blob) openLog({ file: blob });
  } else if (params.get('action') === 'log') {
    history.replaceState(null, '', location.pathname + location.hash);
    openLog();
  } else if (!store.get(LS.welcomed) && !state.me) {
    openWelcome();
  } else if (!langChosen()) {
    openLangPrompt();
  }

  setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) refresh(); }, 90000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.lastFetch > 30000) refresh();
  });
  addEventListener('online', () => { renderChrome(); refresh(); });
  addEventListener('offline', renderChrome);
  registerSW();
}

boot();
