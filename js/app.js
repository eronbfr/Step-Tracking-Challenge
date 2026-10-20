// Team 8 · Step Challenge — app shell: state, routing, data refresh and user flows.
import { CONFIG } from './config.js';
import * as api from './api.js';
import * as M from './metrics.js';
import * as V from './views.js';
import { $, $$, esc, fmt, compact, dateLabel, ago, avatar, icon, ring, toast, openSheet, closeSheet, sheetBody, countUp, confetti, copyText } from './ui.js';

const { store } = api;
const LS = { me: 't8:me', profile: 't8:profile', theme: 't8:theme', welcomed: 't8:welcomed', installHidden: 't8:install-hidden' };
const ROUTES = ['team', 'ranking', 'me', 'sync'];

const state = {
  data: null, model: null, sig: '',
  route: 'team',
  me: store.get(LS.me),                       // { id, token }
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
  const view = { team: V.viewTeam, ranking: V.viewRanking, me: V.viewMe, sync: V.viewSync }[state.route];
  viewEl.innerHTML = view(state);
  V.drawPage(state, viewEl, mount);
  if (state.animate) { countUp(viewEl); state.animate = false; }
  renderChrome();
}

function renderChrome() {
  $$('.nav a[data-route]').forEach(a => a.classList.toggle('on', a.dataset.route === state.route));
  $$('.nav a[data-route]').forEach(a => a.setAttribute('aria-current', a.dataset.route === state.route ? 'page' : 'false'));
  const ctx = state.model && state.model.ctx;
  $('#day-chip').textContent = !ctx ? '' : ctx.status === 'live' ? `Day ${ctx.dayNumber}/${ctx.N}` : ctx.status === 'upcoming' ? `In ${ctx.daysToStart}d` : 'Finished';
  const btn = $('#refresh-btn');
  btn.classList.toggle('spin', state.loading);
  btn.classList.toggle('offline', !navigator.onLine);
  btn.title = navigator.onLine ? `Updated ${ago(state.data && state.data.updatedAt)} · tap to refresh` : 'Offline';
}

function rebuild() {
  if (!state.data) return;
  if (state.me && !state.data.members.some(m => m.id === state.me.id)) { state.me = null; store.del(LS.me); }
  state.model = M.buildModel(state.data, api.today(), state.profile, state.me && state.me.id);
}

function setData(data, { force = false } = {}) {
  const sig = api.today() + JSON.stringify(data.members.map(m => [m.id, m.daily, m.joined, m.autoSyncs, m.lastSyncAt]));
  state.data = data;
  state.pending = api.pendingCount();
  if (!force && sig === state.sig && state.model) return renderChrome();
  state.sig = sig;
  rebuild();
  render();
}

async function refresh({ silent = true } = {}) {
  if (state.loading) return;
  state.loading = true;
  renderChrome();
  try {
    const sent = await api.flushOutbox();
    if (sent) toast(`☁️ ${sent} offline entr${sent > 1 ? 'ies' : 'y'} synced`, { type: 'good' });
    setData(await api.fetchData());
  } catch (e) {
    if (!silent || !state.data) toast(e.network ? 'Offline — showing your last saved data' : e.message, { type: 'warn' });
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
const actions = {
  log: el => openLog({ date: el.dataset.date }),
  member: el => openMember(el.dataset.id),
  signin: () => openSignin(),
  signout: () => {
    store.del(LS.me); state.me = null; rebuild(); render();
    toast('Signed out. See you soon! 👋');
  },
  'rank-by': el => { state.rankBy = el.dataset.k; render(); },
  'team-chart': el => { state.teamChart = el.dataset.k; render(); },
  'toggle-table': el => { state.tables[el.dataset.k] = !state.tables[el.dataset.k]; render(); },
  platform: el => { state.platform = el.dataset.k; render(); },
  theme: el => { state.theme = el.dataset.k; store.set(LS.theme, state.theme); applyTheme(); render(); },
  refresh: () => refresh({ silent: false }),
  'dismiss-install': () => { state.installHidden = true; store.set(LS.installHidden, true); render(); },
  install: () => promptInstall(),
  'copy-sync': async () => {
    if (!state.me) return openSignin();
    const ok = await copyText(api.syncUrl(state.me.id, state.me.token));
    toast(ok ? '🔗 Link copied — paste it in your Shortcut' : 'Could not copy — long-press the link to copy it', { type: ok ? 'good' : 'warn' });
  },
  'share-app': async () => {
    const data = { title: 'Team 8 Step Challenge', text: '👟 Join the Team 8 Step Challenge (Oct 20 – Nov 15)! Install the app and turn on auto-sync:', url: CONFIG.APP_URL };
    if (navigator.share) { try { await navigator.share(data); } catch { /* cancelled */ } return; }
    const ok = await copyText(`${data.text} ${data.url}`);
    toast(ok ? '🔗 Invite copied — paste it in WhatsApp or Teams' : CONFIG.APP_URL);
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
  toast('✅ Saved — your health metrics are now personalized', { type: 'good' });
});

/* ═════════════ Log steps flow ═════════════ */
function openLog({ date, steps, pickScreenshot = false, file = null } = {}) {
  if (!state.model) return;
  if (!state.me) return openSignin({ then: () => openLog({ date, steps, pickScreenshot, file }) });
  const { ctx, me } = state.model;
  if (ctx.status === 'upcoming') return toast(`The challenge starts on ${dateLabel(ctx.start)} — see you there! 👟`);

  const days = ctx.dates.slice(0, ctx.lastIdx + 1).reverse();
  let sel = date && days.includes(date) ? date : days[0];
  const quick = [500, 1000, 2500, 5000];

  const body = openSheet(`
    <div class="log">
      <div class="log-h">${avatar(me, 44)}<div><h2>Log steps</h2><p class="muted">${esc(me.name)}</p></div></div>
      <div class="date-chips" role="radiogroup" aria-label="Day">
        ${days.slice(0, 2).map((d, k) => `<button type="button" role="radio" class="chip" data-date="${d}">${ctx.status === 'live' ? (k === 0 ? 'Today' : 'Yesterday') : dateLabel(d, 'short')}</button>`).join('')}
        ${days.length > 2 ? `<label class="chip select"><span>Other day</span><select aria-label="Other day">${['<option value="">…</option>', ...days.slice(2).map(d => `<option value="${d}">${dateLabel(d)}</option>`)].join('')}</select></label>` : ''}
      </div>
      <p class="log-current" aria-live="polite"></p>
      <label class="steps-input"><input id="steps-in" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="0" aria-label="Steps"><span>steps</span></label>
      <div class="quick">${quick.map(q => `<button type="button" class="chip" data-add="${q}">+${fmt(q)}</button>`).join('')}<button type="button" class="chip" data-clear>Clear</button></div>
      <div class="ocr-status" hidden></div>
      <div class="btn-row">
        <button type="button" class="btn ghost" data-shot>${icon('camera', 18)} From screenshot</button>
        <button type="button" class="btn" data-save>${icon('check', 18)} Save</button>
      </div>
      <input type="file" accept="image/*" data-file hidden>
      <p class="muted sm center">Tired of typing? <a href="#/sync" class="link" data-close>Turn on auto-sync ⚡</a></p>
    </div>`, { label: 'Log steps' });

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
    current.innerHTML = v == null ? `${dateLabel(d)} · nothing logged yet` : `${dateLabel(d)} · currently <b>${fmt(v)}</b> — saving replaces it`;
    show(v || 0);
  };
  pick(sel);
  if (steps) show(steps);

  input.addEventListener('input', () => { const n = parse(); show(n); });
  body.addEventListener('click', e => {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.dataset.date) pick(t.dataset.date);
    else if (t.dataset.add) show(Math.min(100000, parse() + Number(t.dataset.add)));
    else if ('clear' in t.dataset) show(0);
    else if ('shot' in t.dataset) $('[data-file]', body).click();
    else if ('save' in t.dataset) save();
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
    box.innerHTML = `<div class="progress"><i style="width:5%"></i></div><span>Loading the reader…</span>`;
    try {
      const ocr = await import('./ocr.js');
      const res = await ocr.readSteps(f, (p, msg) => {
        box.querySelector('i').style.width = `${Math.round(p * 100)}%`;
        box.querySelector('span').textContent = msg;
      });
      if (res.steps) {
        show(res.steps);
        box.innerHTML = `📷 Found <b>${fmt(res.steps)}</b> steps — please double-check before saving.${res.alternatives.length ? `<div class="quick alt">Not right? ${res.alternatives.map(a => `<button type="button" class="chip" data-alt="${a}">${fmt(a)}</button>`).join('')}</div>` : ''}`;
        $$('[data-alt]', box).forEach(b => b.addEventListener('click', () => show(Number(b.dataset.alt))));
      } else {
        box.innerHTML = '🤔 Couldn\'t find a step count in that image — please type it.';
      }
    } catch (err) {
      box.innerHTML = `⚠️ ${esc(err.message || 'Could not read the screenshot.')}`;
    }
  }

  async function save() {
    const n = parse();
    if (n > 100000) return toast('That looks too high — max 100,000 steps a day', { type: 'warn' });
    const btn = $('[data-save]', body);
    btn.disabled = true;
    btn.classList.add('busy');
    const i = ctx.dates.indexOf(sel);
    const before = me.daily[i];
    const badgesBefore = new Set(me.badges.filter(b => b.earned).map(b => b.id));
    try {
      const res = await api.logSteps({ id: state.me.id, token: state.me.token, date: sel, steps: n });
      applyLocal(state.me.id, sel, n);
      closeSheet();
      const meNow = state.model.me;
      const newBadges = meNow.badges.filter(b => b.earned && !badgesBefore.has(b.id));
      if (n >= ctx.goal && (before || 0) < ctx.goal) { confetti(); toast(`🎉 Goal crushed! ${fmt(n)} steps`, { type: 'good' }); }
      else toast(res.queued ? '📴 Saved offline — will sync automatically' : `✅ ${fmt(n)} steps saved for ${dateLabel(sel, 'short')}`, { type: res.queued ? 'warn' : 'good' });
      newBadges.slice(0, 2).forEach((b, k) => setTimeout(() => toast(`${b.emoji} New badge: ${b.name}!`, { type: 'badge', duration: 4200 }), 900 + k * 1200));
      if (newBadges.length && !(n >= ctx.goal && (before || 0) < ctx.goal)) setTimeout(() => confetti({ count: 80 }), 900);
      if (res.queued) state.pending = api.pendingCount();
      else setTimeout(() => refresh(), 1500);
    } catch (err) {
      btn.disabled = false;
      btn.classList.remove('busy');
      if (/sync key|sign in/i.test(err.message)) { store.del(LS.me); state.me = null; closeSheet(); toast('Please sign in again', { type: 'warn' }); return openSignin(); }
      toast(err.message, { type: 'warn' });
    }
  }
}

function applyLocal(id, date, steps) {
  const dates = M.datesBetween(state.data.challenge.start, state.data.challenge.end);
  const i = dates.indexOf(date);
  state.data = {
    ...state.data,
    members: state.data.members.map(m => m.id !== id ? m : { ...m, daily: Object.assign((m.daily || []).slice(), { [i]: steps }), lastSyncAt: new Date().toISOString(), lastSource: 'app' }),
  };
  setData(state.data, { force: true });
}

/* ═════════════ Sign-in flow (name → PIN) ═════════════ */
function openSignin({ then } = {}) {
  if (!state.model) return;
  const members = state.model.members.slice().sort((a, b) => a.name.localeCompare(b.name));
  const body = openSheet(`
    <div class="signin">
      <h2>Who are you? 👋</h2>
      <p class="muted">Pick your name. You'll create a 4-digit PIN to protect your steps.</p>
      <div class="who-grid">${members.map(m => `<button class="who" data-id="${esc(m.id)}">${avatar(m, 52)}<b>${esc(m.first)}</b><small>${m.joined ? 'joined ✓' : 'new'}</small></button>`).join('')}</div>
      <p class="muted sm center">Just looking? Close this — you can join any time.</p>
    </div>`, { label: 'Sign in' });
  body.addEventListener('click', e => {
    const b = e.target.closest('.who');
    if (b) openPin(state.model.byId[b.dataset.id], then);
  });
}

function openPin(m, then) {
  const creating = !m.joined;
  let first = '', pin = '';
  const body = openSheet(`
    <div class="pin">
      ${avatar(m, 64)}
      <h2>${creating ? `Hi ${esc(m.first)}! Create a PIN` : `Welcome back, ${esc(m.first)}`}</h2>
      <p class="muted pin-msg">${creating ? 'Choose 4 digits. You\'ll use them to sign in on other devices.' : 'Enter your 4-digit PIN.'}</p>
      <div class="pin-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <p class="pin-err" role="alert"></p>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
        <button data-k="back" aria-label="Delete">⌫</button><button data-k="0">0</button><button data-k="ok" aria-label="Confirm">${icon('check', 22)}</button></div>
      <p class="muted sm center">${creating ? 'Not you? Close and pick another name.' : 'Forgot your PIN? Ask the team captain to reset it.'}</p>
    </div>`, { label: 'PIN' });

  const dots = $$('.pin-dots i', body);
  const err = $('.pin-err', body);
  const msg = $('.pin-msg', body);
  const paint = () => dots.forEach((d, k) => d.classList.toggle('on', k < pin.length));
  const shake = text => { err.textContent = text; body.querySelector('.pin-dots').classList.add('shake'); setTimeout(() => body.querySelector('.pin-dots') && body.querySelector('.pin-dots').classList.remove('shake'), 400); pin = ''; paint(); };
  const press = k => {
    if (k === 'back') { pin = pin.slice(0, -1); paint(); return; }
    if (k === 'ok') return pin.length === 4 && submit();
    if (pin.length >= 4) return;
    pin += k; err.textContent = ''; paint();
    if (pin.length === 4) setTimeout(submit, 120);
  };
  async function submit() {
    if (creating && !first) { first = pin; pin = ''; paint(); msg.textContent = 'Repeat your PIN to confirm.'; return; }
    if (creating && first !== pin) { first = ''; msg.textContent = 'Choose 4 digits.'; return shake('PINs didn\'t match — try again.'); }
    body.classList.add('busy');
    try {
      const r = await api.claim(m.id, pin);
      state.me = { id: m.id, token: r.token };
      store.set(LS.me, state.me);
      if (state.data) state.data = { ...state.data, members: state.data.members.map(x => x.id === m.id ? { ...x, joined: true } : x) };
      rebuild(); render();
      closeSheet(true);
      toast(`Welcome${r.created ? '' : ' back'}, ${m.first}! 🎉`, { type: 'good' });
      if (then) then(); else if (r.created) openNextSteps();
    } catch (e) {
      body.classList.remove('busy');
      shake(e.message);
      if (creating) { first = ''; msg.textContent = 'Choose 4 digits.'; }
    }
  }
  body.addEventListener('click', e => { const b = e.target.closest('.keypad button'); if (b) press(b.dataset.k); });
  const onKey = e => {
    if (!body.isConnected) return document.removeEventListener('keydown', onKey);
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter') press('ok');
  };
  document.addEventListener('keydown', onKey);
}

function openNextSteps() {
  openSheet(`
    <div class="center-card next">
      <div class="big-emoji">🎉</div>
      <h2>You're in!</h2>
      <p class="muted">Two quick things to get the most out of the challenge:</p>
      <a class="option" href="#/sync" data-close><span>⚡</span><div><b>Turn on auto-sync</b><small>Your steps update by themselves — 2 minutes, once.</small></div>${icon('chevron', 20)}</a>
      ${V.isStandalone() ? '' : `<button class="option" data-action="install"><span>📲</span><div><b>Install the app</b><small>Open it from your home screen like any app.</small></div>${icon('chevron', 20)}</button>`}
      <button class="option" data-action="log"><span>👟</span><div><b>Log today's steps</b><small>Type them or import a screenshot.</small></div>${icon('chevron', 20)}</button>
    </div>`, { label: 'Next steps' });
}

/* ═════════════ Member detail ═════════════ */
function openMember(id) {
  const m = state.model && state.model.byId[id];
  if (!m) return;
  const { ctx } = state.model;
  const s = m.s;
  const earned = m.badges.filter(b => b.earned);
  const isMe = state.me && state.me.id === m.id;
  const body = openSheet(`
    <div class="member">
      <div class="member-h">${avatar(m, 64)}<div><h2>${esc(m.name)}</h2>
        <p><span class="tag">${s.level.emoji} ${s.level.name}</span><span class="tag">#${m.rank} of ${state.model.team.M}</span></p></div></div>
      <div class="member-stats">
        <div><b>${compact(s.total)}</b><small>total</small></div>
        <div><b>${compact(s.avg)}</b><small>avg / day</small></div>
        <div><b>${compact(s.best)}</b><small>best day</small></div>
        <div><b>${s.current}🔥</b><small>streak</small></div>
      </div>
      <div class="chart" data-member-chart></div>
      <div class="legend"><span><i class="lg-box k-series"></i>${esc(m.first)}</span><span><i class="lg-line k-context"></i>Team average</span><span><i class="lg-dash"></i>Goal 10K</span></div>
      <p class="mini-h">Badges · ${earned.length}/${m.badges.length}</p>
      <div class="badge-chips">${earned.length ? earned.map(b => `<span class="badge-chip" title="${esc(b.desc)}">${b.emoji} ${esc(b.name)}</span>`).join('') : '<span class="muted sm">No badges yet — they\'re coming!</span>'}</div>
      <p class="muted sm">${m.lastSyncAt ? `Last update ${ago(m.lastSyncAt)} via ${V.sourceLabel(m.lastSource)}` : m.joined ? 'Joined — no steps yet' : 'Hasn\'t joined the app yet'} · ${s.km.toFixed(1)} km · ${fmt(s.kcal)} kcal</p>
      ${isMe ? `<button class="btn full" data-action="log">${icon('plus', 18)} Log my steps</button>` : ''}
    </div>`, { label: m.name });
  const host = $('[data-member-chart]', body);
  requestAnimationFrame(() => V.drawMemberChart(state, host, m));
}

/* ═════════════ Welcome (first run) ═════════════ */
function openWelcome() {
  const ctx = state.model.ctx;
  openSheet(`
    <div class="welcome">
      <div class="welcome-art" aria-hidden="true"><img src="icons/icon.svg" alt="" width="88" height="88"></div>
      <h2>Team 8 Step Challenge</h2>
      <p class="welcome-dates">${dateLabel(ctx.start, 'short')} – ${dateLabel(ctx.end, 'short')} · ${ctx.N} days · 10,000 steps a day</p>
      <p class="welcome-flags">🇲🇽 🇺🇾 🇧🇷 🇨🇴 · ${state.model.team.M} teammates, one goal</p>
      <ul class="welcome-list">
        <li><span>⚡</span><div><b>Auto-sync</b> from your phone — no typing</div></li>
        <li><span>📊</span><div><b>Live team dashboard</b> & friendly ranking</div></li>
        <li><span>🏅</span><div><b>Badges, streaks</b> & health stats</div></li>
      </ul>
      <button class="btn lg full" data-action="welcome-go">I'm in — pick my name</button>
      <button class="btn ghost full" data-close>Just look around</button>
    </div>`, { label: 'Welcome', cls: 'tall' });
  store.set(LS.welcomed, true);
}

/* ═════════════ Install & theme ═════════════ */
addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  state.installEvent = e;
  state.canInstall = true;
  if (state.route === 'sync') render();
});
addEventListener('appinstalled', () => { state.installEvent = null; state.canInstall = false; toast('📲 Installed! Find Team 8 Steps on your home screen', { type: 'good' }); });

async function promptInstall() {
  if (state.installEvent) {
    state.installEvent.prompt();
    await state.installEvent.userChoice.catch(() => null);
    state.installEvent = null; state.canInstall = false;
    return;
  }
  openSheet(`
    <div class="center-card">
      <div class="big-emoji">📲</div><h2>Install Team 8 Steps</h2>
      ${V.isIOS() ? `<ol class="steps compact left"><li>Open this page in <b>Safari</b></li><li>Tap <b>Share</b> ${icon('share', 16)} at the bottom</li><li>Scroll and tap <b>Add to Home Screen</b> → <b>Add</b></li></ol>`
        : `<ol class="steps compact left"><li>Open this page in <b>Chrome</b></li><li>Tap the menu <b>⋮</b> (top right)</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b></li></ol>`}
      <p class="muted sm">It opens full-screen, works offline and on Android it appears in the share menu for screenshots.</p>
    </div>`, { label: 'Install' });
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
  // and reloading then would close the welcome / PIN sheet.
  let updating = false;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    const offer = w => toast('✨ A new version is ready', { duration: 0, action: { label: 'Update', run: () => { updating = true; w.postMessage('SKIP_WAITING'); } } });
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
  state.route = routeFromHash();
  $('#refresh-btn').addEventListener('click', () => refresh({ silent: false }));

  const cached = api.cachedData();
  if (cached) setData(cached);
  else setData({ challenge: CONFIG.CHALLENGE, members: CONFIG.ROSTER.map(r => ({ ...r, daily: [] })), updatedAt: null });
  document.body.classList.remove('booting');

  await refresh({ silent: !!cached });

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
