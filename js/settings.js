// Settings ("Ajustes"), laid out like the iPhone's Settings app: grouped inset lists, coloured icons, pages that slide in.
//   #/settings · #/settings/profile · sync · language · appearance · health · reminder · captain · about
import { CONFIG } from './config.js';
import { DEMO } from './api.js';
import { t, tn, lang, LANGS } from './i18n.js';
import { esc, dateLabel, ago, avatar, icon } from './ui.js';
import { viewSync, requestList, isStandalone } from './views.js';

export const SUBPAGES = ['profile', 'sync', 'language', 'appearance', 'health', 'reminder', 'captain', 'about'];
const C = { green: '#34c759', blue: '#007aff', red: '#ff3b30', orange: '#ff9500', indigo: '#5856d6', pink: '#ff2d55', gray: '#8e8e93', teal: '#30b0c7', purple: '#af52de' };

function row({ ic, color, label, value = '', href = '', action = '', k = '', badge = 0, chevron = true, cls = '', sub = '' }) {
  const attrs = href ? `href="${href}"` : `data-action="${action}"${k ? ` data-k="${k}"` : ''}`;
  const tag = href ? 'a' : 'button';
  return `<${tag} class="ios-row ${cls}" ${attrs}>
    ${ic ? `<span class="ios-ic" style="--c:${color}">${icon(ic, 18)}</span>` : ''}
    <span class="ios-label">${label}${sub ? `<small>${sub}</small>` : ''}</span>
    ${badge ? `<span class="ios-badge">${badge}</span>` : ''}
    <span class="ios-value">${value}</span>
    ${chevron ? icon('chevron', 16, 'ios-chev') : ''}</${tag}>`;
}
const group = (rows, { head = '', foot = '', cls = '' } = {}) =>
  `<section class="ios-sec ${cls}">${head ? `<h2 class="ios-head">${head}</h2>` : ''}<div class="ios-group">${rows}</div>${foot ? `<p class="ios-foot">${foot}</p>` : ''}</section>`;
const check = on => (on ? `<span class="ios-check">${icon('check', 20)}</span>` : '');
const nav = title => `<nav class="ios-nav"><a class="ios-back" href="#/settings" data-back>${icon('back', 22)}<span>${t('settings.title')}</span></a>
  <span class="ios-nav-title">${title}</span></nav><h1 class="ios-title">${title}</h1>`;

export function viewSettings(st, sub = '') {
  const page = { profile, sync, language, appearance, health, reminder, captain, about }[sub];
  return `<div class="ios ${sub ? 'sub' : 'root'}">${page ? page(st) : root(st)}</div>`;
}

const isCaptain = st => !!st.model.me && (st.data.admins || []).includes(st.model.me.id);
const themeLabel = th => t(th === 'light' ? 'theme.light' : th === 'dark' ? 'theme.dark' : 'theme.autoLong');

function root(st) {
  const me = st.model.me;
  const p = st.profile;
  const auto = me && me.autoSyncs > 0;
  const hw = [p.heightCm && `${p.heightCm} cm`, p.weightKg && `${p.weightKg} kg`].filter(Boolean).join(' · ');
  const profileCard = me
    ? `<a class="ios-group ios-profile" href="#/settings/profile">${avatar(me, 62, { flagged: false })}
        <span class="ios-label"><b>${esc(me.name)}</b><small>${t('settings.profileSub')}</small></span>${icon('chevron', 16, 'ios-chev')}</a>`
    : `<button class="ios-group ios-profile" data-action="signin"><span class="ios-av-blank">${icon('user', 30)}</span>
        <span class="ios-label"><b>${t('settings.signinTitle')}</b><small>${t('settings.signinSub')}</small></span>${icon('chevron', 16, 'ios-chev')}</button>`;
  return `
    <h1 class="ios-title big">${t('settings.title')}</h1>
    <section class="ios-sec">${profileCard}</section>
    ${st.approvals.length ? group(row({ ic: 'shield', color: C.red, label: t('req.title'), action: 'approvals', badge: st.approvals.length })) : ''}
    ${group(
      row({ ic: 'bolt', color: C.green, label: t('settings.sync'), value: !me ? '' : t(auto ? 'settings.on' : 'settings.off'), href: '#/settings/sync' })
      + row({ ic: 'refresh', color: C.blue, label: t('settings.refresh'), value: st.loading ? `<span class="ios-spin"></span>` : st.data && st.data.updatedAt ? esc(ago(st.data.updatedAt)) : '', action: 'refresh', chevron: false })
      + row({ ic: 'bell', color: C.red, label: t('settings.reminder'), href: '#/settings/reminder' })
      + (isStandalone() ? '' : row({ ic: 'install', color: C.indigo, label: t('settings.install'), action: 'install' })))}
    ${group(
      row({ ic: 'globe', color: C.blue, label: t('settings.langRow'), value: (LANGS.find(l => l.id === lang()) || LANGS[0]).name, href: '#/settings/language' })
      + row({ ic: 'sun', color: C.indigo, label: t('settings.appearance'), value: themeLabel(st.theme), href: '#/settings/appearance' })
      + row({ ic: 'heart', color: C.pink, label: t('settings.health'), value: hw || t(p.units === 'imperial' ? 'form.mi' : 'form.km'), href: '#/settings/health' }))}
    ${isCaptain(st) ? group(row({ ic: 'shield', color: C.orange, label: t('admin.titlePlain'), badge: st.approvals.length, href: '#/settings/captain' })) : ''}
    ${group(
      row({ ic: 'share', color: C.green, label: t('settings.invite'), action: 'share-app', chevron: false })
      + row({ ic: 'calc', color: C.gray, label: t('settings.about'), href: '#/settings/about' }))}
    <p class="ios-ver">Team 8 Step Challenge · v${CONFIG.VERSION}${DEMO ? ` · ${t('common.demoMode')}` : ''}</p>`;
}

function profile(st) {
  const me = st.model.me;
  if (!me) return `${nav(t('settings.profile'))}${group(row({ ic: 'user', color: C.blue, label: t('settings.signinTitle'), sub: t('settings.signinSub'), action: 'signin' }))}`;
  const captain = isCaptain(st);
  const mine = captain ? [] : st.approvals.filter(a => a.m.id === me.id);
  const devices = (me.keys || []).map(k => {
    const here = k.kid === st.kid;
    return `<div class="ios-row static"><span class="ios-ic" style="--c:${C.gray}">${icon('phone', 18)}</span>
      <span class="ios-label"><span>${esc(k.l || '?')}${here ? ` <em class="ios-tag">${t('settings.thisDevice')}</em>` : ''}</span><small>${t('settings.since', { date: k.at ? dateLabel(k.at.slice(0, 10)) : '—' })}</small></span>
      ${here ? '' : `<button class="ios-btn danger" data-action="revoke-device" data-k="${esc(k.kid)}">${t('settings.remove')}</button>`}</div>`;
  }).join('');
  return `${nav(t('settings.profile'))}
    <div class="ios-hero">
      <button class="ios-hero-av" data-action="avatar" aria-label="${esc(t('avatar.change'))}">${avatar(me, 96, { flagged: false })}</button>
      <h2>${esc(me.name)}</h2>
      <button class="ios-link" data-action="avatar">${t(me.avatar ? 'avatar.change' : 'avatar.title')}</button>
    </div>
    ${group(devices, { head: t('settings.devicesPlain'), foot: t('settings.devicesSub') })}
    ${mine.length ? `<section class="ios-sec"><h2 class="ios-head">${t('req.title')}</h2>${requestList(mine)}</section>` : ''}
    ${group(`<button class="ios-row center danger" data-action="signout"><span class="ios-label">${t('settings.signout')}</span></button>`,
      { foot: t('settings.signedAs', { name: esc(me.first) }) })}`;
}

function sync(st) {
  return `${nav(t('settings.sync'))}<div class="ios-plain">${viewSync(st)}</div>`;
}

function language() {
  const cur = lang();
  return `${nav(t('settings.langRow'))}
    ${group(LANGS.map(l => `<button class="ios-row" data-action="lang" data-k="${l.id}" lang="${l.locale}" role="radio" aria-checked="${l.id === cur}">
      <span class="ios-label">${l.name}<small>${t(`lang.${l.id}`)}</small></span>${check(l.id === cur)}</button>`).join(''), { foot: t('settings.langSub') })}`;
}

function appearance(st) {
  const auto = st.theme === 'auto';
  const resolved = auto ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : st.theme;
  const mode = k => `<button class="ios-mode ${resolved === k ? 'on' : ''}" data-action="theme" data-k="${k}" role="radio" aria-checked="${resolved === k}">
    <span class="ios-phone ${k}"><i></i><i></i><i></i></span><b>${t(`theme.${k}`)}</b><span class="ios-radio">${resolved === k ? icon('check', 14) : ''}</span></button>`;
  return `${nav(t('settings.appearance'))}
    ${group(`<div class="ios-modes">${mode('light')}${mode('dark')}</div>
      <div class="ios-row static"><span class="ios-label">${t('theme.autoLong')}</span>
        <button class="ios-switch ${auto ? 'on' : ''}" role="switch" aria-checked="${auto}" aria-label="${esc(t('theme.autoLong'))}" data-action="theme" data-k="${auto ? resolved : 'auto'}"><i></i></button></div>`,
      { foot: t('settings.autoFoot') })}`;
}

function health(st) {
  const p = st.profile;
  const unit = (k, label) => `<button class="ios-row" data-action="units" data-k="${k}" role="radio" aria-checked="${(p.units || 'metric') === k}"><span class="ios-label">${label}</span>${check((p.units || 'metric') === k)}</button>`;
  return `${nav(t('settings.health'))}
    <form data-form="profile" class="ios-sec" autocomplete="off">
      <div class="ios-group">
        <label class="ios-row static"><span class="ios-label">${t('form.height')}</span><span class="ios-input"><input name="heightCm" type="number" inputmode="numeric" min="120" max="230" placeholder="175" value="${p.heightCm || ''}"><i>cm</i></span></label>
        <label class="ios-row static"><span class="ios-label">${t('form.weight')}</span><span class="ios-input"><input name="weightKg" type="number" inputmode="decimal" min="35" max="250" step="0.1" placeholder="70" value="${p.weightKg || ''}"><i>kg</i></span></label>
      </div>
      <p class="ios-foot">${t('settings.healthSub')}</p>
    </form>
    ${group(unit('metric', t('form.km')) + unit('imperial', t('form.mi')), { head: t('form.units') })}`;
}

function gcalUrl(ctx) {
  const d = ctx.start.replace(/-/g, ''), until = ctx.end.replace(/-/g, '');
  const q = new URLSearchParams({ action: 'TEMPLATE', text: t('rem.gcalTitle'), details: t('rem.gcalDetails', { url: CONFIG.APP_URL }), dates: `${d}T210000/${d}T211000`, recur: `RRULE:FREQ=DAILY;UNTIL=${until}` });
  return `https://calendar.google.com/calendar/render?${q}`;
}

function reminder(st) {
  return `${nav(t('settings.reminder'))}
    ${group(`<a class="ios-row" href="assets/reminder.ics" download="team8-step-reminder.ics"><span class="ios-ic" style="--c:${C.red}">${icon('calendar', 18)}</span><span class="ios-label">Apple / Outlook<small>${t('rem.ics')}</small></span>${icon('install', 18, 'ios-chev')}</a>
      <a class="ios-row" href="${gcalUrl(st.model.ctx)}" target="_blank" rel="noopener"><span class="ios-ic" style="--c:${C.blue}">${icon('calendar', 18)}</span><span class="ios-label">Google Calendar<small>${t('rem.gcal')}</small></span>${icon('chevron', 16, 'ios-chev')}</a>`,
      { foot: t('rem.sub') })}`;
}

function captain(st) {
  if (!isCaptain(st)) return `${nav(t('admin.titlePlain'))}`;
  const rows = st.model.members.map(m => `<div class="ios-row static">${avatar(m, 34, { flagged: false })}
    <span class="ios-label">${esc(m.name)}<small>${m.joined ? tn('admin.devices', (m.keys || []).length) : t('admin.notJoined')}${m.lastSyncAt ? ` · ${ago(m.lastSyncAt)}` : ''}</small></span>
    ${m.joined && m.id !== st.me.id ? `<button class="ios-btn danger" data-action="reset-member" data-id="${esc(m.id)}">${t('admin.reset')}</button>` : ''}</div>`).join('');
  return `${nav(t('admin.titlePlain'))}
    <section class="ios-sec"><h2 class="ios-head">${t('req.title')}</h2>${st.approvals.length ? requestList(st.approvals) : `<div class="ios-group"><p class="ios-empty">${t('req.none')}</p></div>`}</section>
    ${group(rows, { head: t('admin.members'), foot: t('admin.sub') })}
    ${group(`<a class="ios-row" href="${esc(CONFIG.SHEET_URL)}" target="_blank" rel="noopener"><span class="ios-ic" style="--c:${C.green}">${icon('table', 18)}</span>
      <span class="ios-label">${t('admin.sheet')}<small>${t('admin.sheetSub')}</small></span>${icon('install', 18, 'ios-chev')}</a>`)}`;
}

function about() {
  return `${nav(t('settings.about'))}
    ${group(`<ul class="ios-calc">${['distance', 'kcal', 'time', 'level', 'avg', 'privacy'].map(k => `<li>${t(`calc.${k}`)}</li>`).join('')}</ul>`, { head: t('calc.title') })}
    ${group(`<div class="ios-row static"><span class="ios-label">${t('settings.version')}</span><span class="ios-value">${CONFIG.VERSION}</span></div>
      <a class="ios-row" href="https://github.com/${CONFIG.REPO}" target="_blank" rel="noopener"><span class="ios-label">${t('settings.source')}</span><span class="ios-value">GitHub</span>${icon('chevron', 16, 'ios-chev')}</a>`,
      { foot: `Team 8 Step Challenge${DEMO ? ` · ${t('common.demoMode')}` : ''} · ${t('settings.madeWith')}` })}`;
}
