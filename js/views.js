// Page views: Team dashboard · Ranking · Me (stats + health) · Auto-sync · Settings.
import { CONFIG } from './config.js';
import * as M from './metrics.js';
import * as C from './charts.js';
import { DEMO, storedSyncLink } from './api.js';
import { codeOf } from './ledger.js';
import * as W from './worldmap.js';
import { t, tn, lang, LANGS } from './i18n.js';
import { esc, fmt, dec, compact, pct, dist, duration, dateLabel, weekdays, ago, avatar, avColor, flag, flagsSupported, icon, ring } from './ui.js';

const SOURCE = { shortcut: 'src.shortcut', app: 'src.app', tasker: 'src.android', android: 'src.android' };
export const sourceLabel = s => (SOURCE[s] ? t(SOURCE[s]) : s ? `${s} 🤖` : t('src.app'));
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /android/i.test(navigator.userAgent);

// Translated names for the language-neutral ids coming from metrics.js
export const levelName = l => t(`level.${l.id}`);
export const badgeName = b => t(`badge.${b.id}`);
export const badgeDesc = b => t(`badge.${b.id}.desc`);

const section = (title, sub, body, { cls = '', actions = '', id = '' } = {}) => `
  <section class="card ${cls}" ${id ? `id="${id}"` : ''}>
    <header class="card-h"><div><h2>${title}</h2>${sub ? `<p class="card-sub">${sub}</p>` : ''}</div>${actions}</header>
    ${body}
  </section>`;

const seg = (action, items, active, label) => `<div class="seg" role="tablist" aria-label="${esc(label)}">${items.map(([k, txt]) =>
  `<button role="tab" aria-selected="${k === active}" class="${k === active ? 'on' : ''}" data-action="${action}" data-k="${k}">${txt}</button>`).join('')}</div>`;

const tableToggle = (k, on) => `<button class="link-btn" data-action="toggle-table" data-k="${k}">${icon('table', 16)} ${t(on ? 'table.hide' : 'table.show')}</button>`;

const kpi = (emoji, label, value, sub) => `<div class="kpi"><span class="kpi-ic" aria-hidden="true">${emoji}</span><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span><span class="kpi-sub">${sub}</span></div>`;

const statusPill = ctx =>
  ctx.status === 'live' ? `<span class="pill">${t('status.day', { n: ctx.dayNumber, N: ctx.N })}</span><span class="pill ghost">${ctx.daysLeft ? tn('status.daysLeft', ctx.daysLeft) : t('status.lastDay')}</span>`
  : ctx.status === 'upcoming' ? `<span class="pill">${tn('status.startsIn', ctx.daysToStart)}</span><span class="pill ghost">${dateLabel(ctx.start, 'short')} – ${dateLabel(ctx.end, 'short')}</span>`
  : `<span class="pill">${t('status.complete')}</span><span class="pill ghost">${t('status.days', { n: ctx.N })}</span>`;

/** Language picker used by Settings, the welcome sheet and the first-run language prompt. */
export const langOptions = (variant = '') => {
  const cur = lang();
  return `<div class="lang-list ${variant}" role="radiogroup" aria-label="${esc(t('settings.lang'))}">${LANGS.map(l => `
    <button class="lang-opt ${l.id === cur ? 'on' : ''}" role="radio" aria-checked="${l.id === cur}" data-action="lang" data-k="${l.id}" lang="${l.locale}">
      <span class="lang-code">${l.code}</span><b>${l.name}</b>${l.id === cur ? icon('check', 18) : ''}</button>`).join('')}</div>`;
};

/* ════════════════════════════════ TEAM ════════════════════════════════ */
export function viewTeam(st) {
  const { ctx, team, members, me } = st.model;
  const foodOfDay = M.FOODS[Math.max(0, ctx.dayNumber) % M.FOODS.length];
  const units = st.profile.units;
  const remainingDays = ctx.N - ctx.complete;
  const gapPP = remainingDays > 0 ? (team.teamGoal - team.projected) / team.M / remainingDays : 0;
  const projection = ctx.status === 'upcoming' ? t('team.proj.upcoming')
    : ctx.status === 'finished' ? t('team.proj.final', { total: fmt(team.total), pct: pct(team.progress) })
    : ctx.complete === 0 ? t('team.proj.day1')
    : team.projectedPct >= 1 ? t('team.proj.onTrack', { proj: compact(team.projected), pct: pct(team.projectedPct) })
    : t('team.proj.gap', { proj: compact(team.projected), pct: pct(team.projectedPct), gap: fmt(gapPP) });

  const todayIdx = ctx.status === 'live' ? ctx.todayIdx : ctx.lastIdx;
  const todayList = members.slice().sort((a, b) => (b.daily[todayIdx] ?? -1) - (a.daily[todayIdx] ?? -1));
  const showToday = todayIdx >= 0;

  return `
  <section class="hero" aria-label="${esc(t('team.progressAria'))}">
    <div class="hero-top">${statusPill(ctx)}</div>
    <div class="hero-main">
      <div class="hero-ring">${ring(team.progress, { size: 132, stroke: 12, cls: 'on-dark', label: t('team.ofTeamGoal', { pct: pct(team.progress) }) })}
        <div class="ring-center"><b>${pct(team.progress)}</b><small>${t('team.ofGoal')}</small></div></div>
      <div class="hero-stats">
        <span class="hero-label">${t('team.steps')}</span>
        <span class="hero-num" data-count="${team.total}">${fmt(team.total)}</span>
        <span class="hero-sub">${t('team.goalLine', { goal: compact(team.teamGoal), M: team.M, N: ctx.N })}</span>
      </div>
    </div>
    <div class="hero-chips">
      <span class="chip-glass">${t('team.chipToday', { v: compact(team.today || 0) })}</span>
      <span class="chip-glass">${t('team.chipGoal', { a: team.goalToday, M: team.M })}</span>
      <span class="chip-glass">${t('team.chipLogged', { a: team.loggedToday, M: team.M })}</span>
    </div>
    <p class="hero-foot">${projection}</p>
  </section>
  ${banners(st)}

  ${showToday ? section(t(ctx.status === 'live' ? 'common.today' : 'common.lastDay'), t('team.todaySub', { date: dateLabel(ctx.dates[todayIdx]), a: team.loggedCount[todayIdx], M: team.M }), `
    <div class="mates">${todayList.map(m => {
      const v = m.daily[todayIdx];
      const isMe = me && me.id === m.id;
      return `<button class="mate ${isMe ? 'me' : ''} ${v == null ? 'idle' : ''}" data-action="member" data-id="${esc(m.id)}" aria-label="${esc(v == null ? t('mate.notLoggedAria', { name: m.name }) : t('mate.stepsAria', { name: m.name, v: fmt(v) }))}">
        <span class="mate-ring">${ring((v || 0) / ctx.goal, { size: 70, stroke: 6 })}${avatar(m, 50)}</span>
        <span class="mate-name">${esc(m.first)}${isMe ? t('common.youSuffix') : ''}</span>
        <span class="mate-steps">${v == null ? t('mate.notYet') : `${compact(v)}${v >= ctx.goal ? ' ✓' : ''}`}</span>
      </button>`;
    }).join('')}</div>`, { actions: me ? `<button class="btn sm" data-action="log">${icon('plus', 16)} ${t('common.log')}</button>` : '' }) : ''}

  ${teamMap(st)}

  <div class="kpis">
    ${kpi('📏', t('kpi.distance'), dist(team.km, units).text, t('kpi.marathons', { n: dec(team.km / 42.195, 1) }))}
    ${kpi('🔥', t('kpi.kcal'), `${compact(team.kcal)} kcal`, `≈ ${fmt(team.kcal / foodOfDay.kcal)} ${t(`food.${foodOfDay.id}`)} ${foodOfDay.emoji}`)}
    ${kpi('⏱️', t('kpi.walkTime'), duration(team.minutes), t('kpi.minPerson', { n: fmt(team.avgPerMember / 100) }))}
    ${kpi('🎯', t('kpi.goalDays'), fmt(team.memberDayGoals), team.best ? t('kpi.bestTeamDay', { v: compact(team.best) }) : t('kpi.beFirst'))}
  </div>

  ${section(t('team.steps'), t(st.teamChart === 'daily' ? 'chart.subDaily' : 'chart.subTotal'), `
    <div class="chart" data-chart="teamMain" aria-label="${esc(t('chart.teamAria'))}"></div>
    ${st.teamChart === 'total' ? `<div class="legend"><span><i class="lg-line k-series"></i>${t('lg.teamTotal')}</span><span><i class="lg-line k-pace"></i>${t('lg.goalPace')}</span></div>`
      : `<div class="legend"><span><i class="lg-box k-series"></i>${t('team.steps')}</span><span><i class="lg-box k-emph"></i>${t('common.today')}</span><span><i class="lg-dash"></i>${t('lg.teamGoal', { v: compact(team.dailyGoal) })}</span></div>`}
    <div class="card-foot">${tableToggle('team', st.tables.team)}</div>
    ${st.tables.team ? C.table([t('th.day'), t('team.steps'), t('th.logged'), t('th.cumulative')], ctx.dates.slice(0, ctx.lastIdx + 1).map((d, i) =>
      [dateLabel(d), fmt(team.dailyTotals[i]), `${team.loggedCount[i]}/${team.M}`, fmt(team.cumulative[i])])) : ''}
  `, { cls: 'wide', actions: seg('team-chart', [['daily', t('chart.daily')], ['total', t('chart.total')]], st.teamChart, t('chart.type')) })}

  ${section(t('heat.title'), t('heat.sub'), `
    <div class="chart heat" data-chart="heatmap" aria-label="${esc(t('heat.aria'))}"></div>
    <div class="legend heat-legend"><span>${t('heat.less')}</span>${[1, 2, 3, 4, 5, 6].map(b => `<i class="hl hc-${b}"></i>`).join('')}<span>${t('heat.more')}</span>
      <span class="sep"></span><span><i class="hl-dot"></i>10K+</span><span><i class="hl hc-n"></i>${t('heat.notLogged')}</span></div>
    <div class="card-foot">${tableToggle('heat', st.tables.heat)}</div>
    ${st.tables.heat ? C.table([t('th.day'), ...members.map(m => m.first)], ctx.dates.slice(0, ctx.lastIdx + 1).map((d, i) =>
      [dateLabel(d, 'short'), ...members.map(m => C.fmtSteps(m.daily[i]))])) : ''}
  `, { cls: 'wide' })}

  ${expedition(st)}
  ${funFacts(st)}
  <p class="foot-note">${st.data && st.data.updatedAt ? t('team.updated', { ago: ago(st.data.updatedAt) }) : ''} · ${t('team.estimates')}
    <a href="#/sync" class="link">${t('team.howCalc')}</a></p>`;
}

function banners(st) {
  let out = '';
  if (DEMO) out += `<div class="banner demo">🧪 <span>${t('banner.demo')}${t('banner.demoRemove')}</span></div>`;
  if (st.approvals.length) {
    const a = st.approvals[0];
    out += `<button class="banner approve" data-action="approvals"><span class="banner-emoji">🔐</span><span>${st.approvals.length === 1
      ? t('banner.approve.one', { name: esc(a.m.name), device: esc(a.r.l || '?') }) : t('banner.approve.other', { n: st.approvals.length })}</span>${icon('chevron', 20)}</button>`;
  }
  if (st.waiting) out += `<button class="banner approve" data-action="wait"><span class="banner-emoji">⏳</span><span>${t('banner.waiting', { code: codeOf(st.kid) })}</span>${icon('chevron', 20)}</button>`;
  if (st.pending) out += `<div class="banner warn">${icon('wifi', 18)} <span>${tn('banner.pending', st.pending)}</span></div>`;
  if (!isStandalone() && !st.installHidden) out += `<div class="banner install"><span class="banner-emoji">📲</span><span>${t('banner.install')}</span>
    <button class="btn sm" data-action="install">${t('common.install')}</button><button class="icon-btn" data-action="dismiss-install" aria-label="${esc(t('common.dismiss'))}">${icon('close', 18)}</button></div>`;
  if (!st.me && !st.waiting && st.model.ctx.status !== 'finished') out += `<button class="banner join" data-action="signin"><span class="banner-emoji">👋</span><span>${t('banner.join')}</span>${icon('chevron', 20)}</button>`;
  return out;
}

/** World map with everyone pinned on their home city (js/worldmap.js) + the country battle. */
function teamMap(st) {
  const { members } = st.model;
  const stats = W.countryStats(members);
  if (!stats.length) return '';
  const best = Math.max(...stats.map(c => c.avg));
  const view = W.mapMode(), focus = W.mapFocus();
  const modes = `<div class="seg" role="tablist" aria-label="${esc(t('map.modeAria'))}">${[['team', t('map.team')], ['world', t('map.world')]].map(([k, txt]) =>
    `<button role="tab" aria-selected="${k === view}" class="${k === view ? 'on' : ''}" data-action="map-mode" data-k="${k}">${txt}</button>`).join('')}</div>`;
  const sub = t('map.sub', {
    people: tn('map.people', members.filter(W.placeOf).length), countries: tn('map.countries', stats.length),
    d: dist(W.spanKm(members), st.profile.units).text,
  });
  return section(t('map.title'), sub, `
    <div class="wmap-host" data-chart="worldmap"></div>
    <p class="mini-h">${t('map.battle')}</p>
    <div class="wm-cc">${stats.map((c, k) => `
      <button class="wm-c ${focus === c.cc ? 'on' : ''}" data-action="map-focus" data-cc="${c.cc}" aria-label="${esc(t('map.focusAria', { country: c.name }))}">
        <span class="wm-c-flag" aria-hidden="true">${flagsSupported() ? flag(c.cc) : `<span class="wm-c-cc">${c.cc}</span>`}</span>
        <span class="wm-c-name"><b>${esc(c.name)}${k === 0 && c.avg > 0 ? ' 👑' : ''}</b><small>${tn('map.people', c.n)} · ${c.places.map(W.placeName).join(', ')}</small></span>
        <span class="wm-c-val"><b>${c.avg > 0 ? compact(c.avg) : '—'}</b><small>${t('map.avg')}</small></span>
        <span class="wm-c-bar"><i style="width:${best > 0 ? ((c.avg / best) * 100).toFixed(1) : 0}%"></i></span>
      </button>`).join('')}</div>`, { cls: 'wide map-card', id: 'team-map', actions: modes });
}

function expedition(st) {
  const { team, ctx } = st.model;
  const km = team.km;
  const ms = M.MILESTONES;
  const nextIdx = ms.findIndex(x => km < x.km);
  const prevKm = nextIdx > 0 ? ms[nextIdx - 1].km : 0;
  const next = nextIdx >= 0 ? ms[nextIdx] : null;
  const reachedDay = target => {
    const i = team.cumulative.findIndex(c => c != null && M.toKm(c) >= target);
    return i >= 0 ? t('exp.dayN', { n: i + 1 }) : '';
  };
  const units = st.profile.units;
  const name = x => t(`ms.${x.id}.name`), note = x => t(`ms.${x.id}.note`);
  return section(t('exp.title'), t('exp.sub', { d: dist(km, units).text }), `
    ${next ? `<div class="exp-next">
        <span class="exp-emoji" aria-hidden="true">${next.emoji}</span>
        <div><b>${t('exp.next', { name: name(next) })}</b><span>${t('exp.toGo', { d: dist(next.km - km, units).text })} · ${note(next)}</span>
        <div class="bar"><i style="width:${Math.min(100, ((km - prevKm) / (next.km - prevKm)) * 100).toFixed(1)}%"></i></div></div>
      </div>` : `<div class="exp-next done"><span class="exp-emoji">🏆</span><div><b>${t('exp.allDone')}</b><span>${t('exp.legendary')}</span></div></div>`}
    <ol class="trail">${ms.map((x, k) => {
      const done = km >= x.km;
      return `<li class="${done ? 'done' : ''} ${k === nextIdx ? 'next' : ''}"><span class="trail-dot">${done ? icon('check', 14) : x.emoji}</span>
        <span class="trail-name">${name(x)}<small>${note(x)}</small></span>
        <span class="trail-km">${dist(x.km, units).text}${done ? `<small>${reachedDay(x.km)}</small>` : ''}</span></li>`;
    }).join('')}</ol>`, { cls: ctx.status === 'upcoming' ? 'muted-card' : '' });
}

function funFacts(st) {
  const { team } = st.model;
  const km = team.km;
  return section(t('facts.title'), t('facts.sub'), `
    <div class="facts">
      <div class="fact"><span>🌍</span><p>${t('facts.earth', { v: pct(km / M.EARTH_KM, 2) })}</p></div>
      <div class="fact"><span>🚗</span><p>${t('facts.co2', { v: fmt(M.toCo2Kg(km)) })}</p></div>
      <div class="fact"><span>🧈</span><p>${t('facts.fat', { v: dec(M.toFatGrams(team.kcal) / 1000, 1), kcal: fmt(team.kcal) })}</p></div>
      <div class="fact"><span>🏟️</span><p>${t('facts.laps', { v: fmt(km / 0.4) })}</p></div>
    </div>
    <p class="mini-h">${t('facts.foods')}</p>
    <div class="foods">${M.FOODS.map(f => `<div class="food"><span>${f.emoji}</span><b>${fmt(team.kcal / f.kcal)}</b><small>${t(`food.${f.id}`)}</small></div>`).join('')}</div>`);
}

/* ════════════════════════════════ RANKING ════════════════════════════════ */
const RANK = {
  total:  { label: 'rank.total',   unit: 'unit.steps',    steps: true, get: s => s.total },
  week:   { label: 'rank.week',    unit: 'unit.steps',    steps: true, get: s => s.thisWeek },
  today:  { label: 'common.today', unit: 'unit.steps',    steps: true, get: s => s.today || 0 },
  avg:    { label: 'rank.avg',     unit: 'unit.stepsDay', steps: true, get: s => Math.round(s.avg) },
  goals:  { label: 'kpi.goalDays', unit: 'unit.days',     get: s => s.goalDays },
  streak: { label: 'rank.streak',  unit: 'unit.daysFire', get: s => s.current },
};

export function viewRanking(st) {
  const { members, ctx, me } = st.model;
  const R = RANK[st.rankBy] || RANK.total;
  const list = members.slice().sort((a, b) => R.get(b.s) - R.get(a.s) || b.s.total - a.s.total || a.name.localeCompare(b.name));
  const leader = list.length ? R.get(list[0].s) : 0;
  let place = 0, prevVal = null;
  const ranked = list.map((m, k) => { const v = R.get(m.s); if (v !== prevVal) { place = k + 1; prevVal = v; } return { m, v, place }; });
  const last7 = m => m.daily.slice(Math.max(0, ctx.lastIdx - 6), ctx.lastIdx + 1);
  const hof = M.hallOfFame(members, ctx);
  const medal = ['🥇', '🥈', '🥉'];
  const fmtV = v => (R.steps ? fmt(v) : v);

  const podium = leader > 0 ? `<div class="podium">${[1, 0, 2].map(k => {
      const r = ranked[k];
      if (!r) return '<div></div>';
      return `<button class="podium-col p${k + 1}" data-action="member" data-id="${esc(r.m.id)}">
        <span class="podium-medal">${medal[r.place - 1] || ''}</span>${avatar(r.m, k === 0 ? 68 : 56)}
        <span class="podium-name">${esc(r.m.first)}</span><span class="podium-val">${R.steps ? compact(r.v) : r.v}</span>
        <span class="podium-base">${r.place}</span></button>`;
    }).join('')}</div>`
    : `<div class="empty">🏁<p><b>${t('rank.emptyTitle')}</b><br>${t('rank.emptyText')}</p></div>`;

  return `
  <div class="page-h"><h1>${t('rank.title')}</h1><p>${t('rank.sub')}</p></div>
  <div class="chips-scroll">${seg('rank-by', Object.entries(RANK).map(([k, r]) => [k, t(r.label)]), st.rankBy, t('rank.metricAria'))}</div>
  ${podium}
  <ol class="board" aria-label="${esc(t('rank.byAria', { label: t(R.label) }))}">${ranked.map(({ m, v, place }) => `
    <li><button class="row ${me && me.id === m.id ? 'me' : ''}" data-action="member" data-id="${esc(m.id)}">
      <span class="row-rank">${place <= 3 && leader > 0 ? medal[place - 1] : place}</span>
      ${avatar(m, 42)}
      <span class="row-main"><span class="row-name">${esc(m.name)}${me && me.id === m.id ? ` <em>${t('common.you')}</em>` : ''}</span>
        <span class="row-sub">${m.s.level.emoji} ${levelName(m.s.level)} · 🏅 ${m.badgeCount}${m.s.current >= 2 ? ` · 🔥 ${m.s.current}` : ''}</span>
        <span class="row-bar"><i style="width:${leader ? ((v / leader) * 100).toFixed(1) : 0}%"></i></span></span>
      <span class="row-spark">${C.miniBars(last7(m), ctx.goal)}</span>
      <span class="row-val"><b>${fmtV(v)}</b><small>${t(R.unit)}</small></span>
    </button></li>`).join('')}
  </ol>
  ${hof.length ? `<div class="page-h sm"><h2>${t('rank.hof')}</h2></div><div class="hof">${hof.map(h => `
    <button class="hof-card" data-action="member" data-id="${esc(h.m.id)}">
      <span class="hof-emoji">${h.emoji}</span><span class="hof-title">${t(`hof.${h.id}.title`)}</span>
      <span class="hof-who">${avatar(h.m, 28, { flagged: false })}<b>${esc(h.m.first)}</b></span>
      <span class="hof-val">${h.pct ? `+${h.value}` : fmt(h.value)} <small>${t(`hof.${h.id}.unit`)}${h.note ? ` · ${dateLabel(h.note, 'short')}` : ''}</small></span>
    </button>`).join('')}</div>` : ''}`;
}

/* ════════════════════════════════ ME ════════════════════════════════ */
const INSIGHTS = [
  { emoji: '🎯', k: 'sweet', src: 'Paluch et al., The Lancet Public Health, 2022',
    you: s => (s.avg < 1 ? '' : s.avg < 8000 ? t('ins.sweet.below', { avg: fmt(s.avg), gap: fmt(8000 - s.avg) }) : s.avg <= 10000 ? t('ins.sweet.in') : t('ins.sweet.above')) },
  { emoji: '❤️', k: 'k', src: 'Banach et al., European Journal of Preventive Cardiology, 2023',
    you: s => (s.avg >= 1 ? t('ins.k.you', { best: fmt(s.best) }) : '') },
  { emoji: '🧠', k: 'brain', src: 'del Pozo Cruz et al., JAMA Neurology, 2022',
    you: () => '' },
  { emoji: '⏱️', k: 'who', src: () => t('ins.who.src'),
    you: s => t('ins.who.you', { v: fmt(s.weekActive) }) },
];

const gearBtn = cls => `<a class="icon-btn ${cls}" href="#/settings" aria-label="${esc(t('settings.open'))}" title="${esc(t('settings.title'))}">${icon('gear', 20)}</a>`;

export function viewMe(st) {
  const { me, ctx, team } = st.model;
  if (!me) return `
    <div class="page-h with-action"><div><h1>${t('nav.me')}</h1></div>${gearBtn('')}</div>
    <section class="card center-card"><div class="big-emoji">👟</div><h2>${t('me.joinTitle')}</h2>
      <p class="muted">${t('me.joinText')}</p>
      <button class="btn lg" data-action="signin">${t('me.pickName')}</button></section>
    ${settingsLink()}`;

  const s = me.ps, p = st.profile, units = p.units;
  const today = s.today || 0;
  const toGo = Math.max(0, ctx.goal - today);
  const level = s.level;
  const bmi = M.bmiOf(p);
  const lk = M.LEVELS.indexOf(level);
  const lo = M.LEVELS[lk].min, hi = M.LEVELS[lk + 1] ? M.LEVELS[lk + 1].min : lo + 5000;
  const levelPos = ((lk + Math.min(1, (s.avg - lo) / (hi - lo))) / M.LEVELS.length) * 100;
  const earned = me.badges.filter(b => b.earned).length;

  return `
  <section class="card me-head">
    <button class="me-av" data-action="avatar" aria-label="${esc(t('avatar.change'))}" title="${esc(t('avatar.change'))}">${avatar(me, 64)}<span class="me-av-edit" aria-hidden="true">${icon('edit', 12)}</span></button>
    <div class="me-id"><h1>${esc(me.name)}</h1>
      <p><span class="tag">${level.emoji} ${levelName(level)}</span><span class="tag">${t('me.rankOf', { rank: me.rank, M: team.M })}</span><span class="tag">🏅 ${earned}/${me.badges.length}</span></p>
      <p class="muted sm">${me.lastSyncAt ? t('me.lastUpdate', { ago: ago(me.lastSyncAt), src: sourceLabel(me.lastSource) }) : t('me.noSteps')}</p></div>
    ${gearBtn('me-gear')}
  </section>

  <section class="card today-me">
    <div class="today-ring">${ring(today / ctx.goal, { size: 176, stroke: 16, cls: 'big', label: t('me.todayAria', { v: fmt(today), goal: fmt(ctx.goal) }) })}
      <div class="ring-center"><small>${t(ctx.status === 'live' ? 'common.today' : 'common.lastDay')}</small><b data-count="${today}">${fmt(today)}</b><small>${t('me.of', { goal: fmt(ctx.goal) })}</small></div></div>
    <p class="today-msg">${ctx.status !== 'live' ? '' : s.today == null ? t('me.nothingToday')
      : toGo ? t('me.toGo', { v: fmt(toGo), min: Math.ceil(toGo / 100) }) : t('me.crushed', { v: fmt(today - ctx.goal) })}</p>
    <div class="btn-row"><button class="btn" data-action="log">${icon('plus', 18)} ${t('common.logSteps')}</button><a class="btn ghost" href="#/sync">${icon('bolt', 18)} ${t('nav.sync')}</a></div>
  </section>

  <div class="stat-grid">
    ${stat(t('stat.total'), fmt(s.total), t('stat.totalSub', { pct: pct(s.pctTarget), target: compact(ctx.target) }))}
    ${stat(t('stat.avg'), fmt(s.avg), ctx.complete ? tn('stat.avgSub', ctx.complete) : t('stat.todaySoFar'))}
    ${stat(t('stat.best'), s.best ? fmt(s.best) : '—', s.bestIdx >= 0 ? dateLabel(ctx.dates[s.bestIdx]) : t('stat.waiting'))}
    ${stat(t('stat.streak'), `${s.current} 🔥`, tn('stat.longest', s.longest))}
    ${stat(t('kpi.goalDays'), `${s.goalDays}`, t('stat.goalDaysSub', { n: Math.max(1, ctx.lastIdx + 1) }))}
    ${stat(t('stat.consistency'), s.consistency == null ? '—' : pct(s.consistency), tn('stat.logged', s.logged))}
    ${stat(t('stat.projected'), compact(s.projected), t('stat.atPace'))}
    ${stat(t('stat.need'), s.remaining ? fmt(s.need) : '—', s.remaining ? t('stat.toReach', { v: compact(ctx.target) }) : t('stat.over'))}
  </div>

  ${section(t('me.dailyTitle'), t('me.dailySub'), `
    <div class="chart" data-chart="meDaily" aria-label="${esc(t('me.dailyTitle'))}"></div>
    <div class="legend"><span><i class="lg-box k-emph"></i>${t('lg.you')}</span><span><i class="lg-line k-context"></i>${t('lg.teamAvg')}</span><span><i class="lg-dash"></i>${t('lg.goal10k')}</span></div>
    <div class="card-foot">${tableToggle('me', st.tables.me)}</div>
    ${st.tables.me ? C.table([t('th.day'), t('lg.you'), t('th.teamAvg')], ctx.dates.slice(0, ctx.lastIdx + 1).map((d, i) => [dateLabel(d), C.fmtSteps(me.daily[i]), C.fmtSteps(team.avgLogged[i])])) : ''}`, { cls: 'wide' })}

  ${section(t('me.weekTitle'), s.weekdayAvg != null ? t('me.weekSub', { a: fmt(s.weekdayAvg), b: s.weekendAvg != null ? fmt(s.weekendAvg) : '—' }) : t('me.weekEmpty'), `
    <div class="chart" data-chart="meDow" aria-label="${esc(t('me.dowAria'))}"></div>`)}

  ${section(t('health.title'), p.heightCm || p.weightKg ? t('health.personal') : t('health.averages'), `
    <div class="health-grid">
      ${health('📏', t('kpi.distance'), dist(s.km, units).text, t('hm.stride', { n: (M.strideM(p) * 100).toFixed(0) }))}
      ${health('🔥', t('kpi.kcal'), `${fmt(s.kcal)} kcal`, t('hm.tacos', { n: fmt(s.kcal / 170) }))}
      ${health('⏱️', t('kpi.walkTime'), duration(s.minutes), t('hm.minDay', { n: fmt(s.avg / 100) }))}
      ${health('🧈', t('hm.fat'), `${fmt(M.toFatGrams(s.kcal))} g`, t('hm.fatSub'))}
      ${health('🌿', t('hm.co2'), `${fmt(M.toCo2Kg(s.km))} kg`, t('hm.co2Sub'))}
      ${bmi ? health('⚖️', t('hm.bmi'), dec(bmi, 1), t(`bmi.${M.bmiClass(bmi)}`)) : health('⚖️', t('hm.bmi'), '—', `<a class="link" href="#/settings">${t('hm.addHW')}</a>`)}
    </div>
    <div class="who">
      ${ring(s.weekActive / 150, { size: 84, stroke: 9, label: t('who.aria') })}
      <div><b>${t('who.title')}</b><p>${t('who.text', { v: fmt(s.weekActive) })} ${s.weekActive >= 150 ? t('who.reached') : t('who.toGo', { v: fmt(150 - s.weekActive) })}</p>
      <p class="muted sm">${t('who.note')}</p></div>
    </div>
    <div class="levels" aria-label="${esc(t('level.aria'))}">
      <p class="level-h">${t('level.h', { emoji: level.emoji, name: levelName(level), v: fmt(s.avg) })}</p>
      <div class="level-track">${M.LEVELS.map(l => `<span class="${l === level ? 'on' : ''}">${l.emoji}</span>`).join('')}<i class="level-marker" style="left:${levelPos.toFixed(1)}%"></i></div>
      <div class="level-scale"><span>0</span><span>5K</span><span>${dec(7.5, 1)}K</span><span>10K</span><span>${dec(12.5, 1)}K+</span></div>
      <p class="muted sm">${t(`level.${level.id}.tip`)} · ${t('level.source')}</p>
    </div>`)}

  ${section(t('sci.title'), t('sci.sub'), `
    <div class="insights">${INSIGHTS.map(x => {
      const you = x.you(s);
      return `<article class="insight"><span class="insight-emoji">${x.emoji}</span><div><h3>${t(`ins.${x.k}.title`)}</h3><p>${t(`ins.${x.k}.body`)}</p>${you ? `<p class="insight-you">${you}</p>` : ''}<cite>${typeof x.src === 'function' ? x.src() : x.src}</cite></div></article>`;
    }).join('')}</div>
    <p class="muted sm">${t('sci.disclaimer')}</p>`)}

  ${section(t('badges.title', { a: earned, b: me.badges.length }), t('badges.sub'), `
    <div class="badges">${me.badges.map(b => `<div class="badge ${b.earned ? 'earned' : ''}" title="${esc(badgeDesc(b))}">
      <span class="badge-emoji">${b.emoji}</span><b>${esc(badgeName(b))}</b><small>${esc(badgeDesc(b))}</small>
      ${b.earned ? '' : `<span class="bar thin"><i style="width:${(b.progress * 100).toFixed(0)}%"></i></span>`}</div>`).join('')}</div>`)}

  ${settingsLink()}`;
}

const stat = (label, value, sub) => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span><span class="stat-sub">${sub}</span></div>`;
const health = (emoji, label, value, sub) => `<div class="hm"><span class="hm-ic">${emoji}</span><span class="hm-label">${label}</span><b>${value}</b><small>${sub}</small></div>`;

const settingsLink = () => `<a class="card settings-link" href="#/settings"><span class="settings-ic">${icon('gear', 22)}</span>
  <span><b>${t('settings.title')}</b><small>${t('me.settingsLink')}</small></span>${icon('chevron', 20)}</a>`;

/* ════════════════════════════════ SETTINGS ════════════════════════════════ */
export function viewSettings(st) {
  const p = st.profile;
  const me = st.model.me;
  const captain = !!me && (st.data.admins || []).includes(me.id);
  const row = (first, label, control) => `<div class="setting-row ${first ? 'first' : ''}"><span>${label}</span>${control}</div>`;
  const invite = row(false, `${icon('share', 18)} ${t('settings.invite')}`, `<button class="btn sm ghost" data-action="share-app">${t('settings.share')}</button>`);
  return `
  <div class="page-h"><h1>${t('settings.title')} ⚙️</h1><p>${t('settings.sub')}</p></div>

  ${section(t('settings.lang'), t('settings.langSub'), langOptions())}

  ${section(t('settings.avatar'), t('settings.avatarSub'), me ? `
    <div class="av-current">${avatar(me, 72, { flagged: false })}<div><b>${esc(me.name)}</b><small>${t(me.avatar ? 'settings.avatarSet' : 'settings.avatarNone')}</small></div></div>
    <button class="btn full" data-action="avatar">${icon('user', 18)} ${t(me.avatar ? 'avatar.change' : 'avatar.title')}</button>`
    : `<p class="muted">${t('settings.avatarSignin')}</p><button class="btn av-signin" data-action="signin">${t('common.signin')}</button>`)}

  ${me ? devicesSection(st, me, captain) : ''}
  ${captain ? captainSection(st) : ''}

  ${section(t('settings.appearance'), '', row(true, `${icon('moon', 18)} ${t('settings.theme')}`,
    seg('theme', [['auto', t('theme.auto')], ['light', t('theme.light')], ['dark', t('theme.dark')]], st.theme, t('settings.theme'))))}

  ${section(t('settings.health'), t('settings.healthSub'), `
    <form class="form" data-form="profile">
      <label>${t('form.height')} <span class="input-unit"><input name="heightCm" type="number" inputmode="numeric" min="120" max="230" placeholder="175" value="${p.heightCm || ''}"><i>cm</i></span></label>
      <label>${t('form.weight')} <span class="input-unit"><input name="weightKg" type="number" inputmode="decimal" min="35" max="250" step="0.1" placeholder="70" value="${p.weightKg || ''}"><i>kg</i></span></label>
      <label>${t('form.units')} <select name="units"><option value="metric" ${p.units !== 'imperial' ? 'selected' : ''}>${t('form.km')}</option><option value="imperial" ${p.units === 'imperial' ? 'selected' : ''}>${t('form.mi')}</option></select></label>
      <button class="btn" type="submit">${icon('check', 18)} ${t('common.save')}</button>
    </form>`)}

  ${section(t('settings.account'), '', (st.me
    ? row(true, `${icon('logout', 18)} ${t('settings.signedAs', { name: esc(me ? me.first : st.me.id) })}`, `<button class="btn sm ghost" data-action="signout">${t('settings.signout')}</button>`)
    : row(true, `${icon('user', 18)} ${t('settings.notSigned')}`, `<button class="btn sm" data-action="signin">${t('common.signin')}</button>`)) + invite)}

  <p class="foot-note">Team 8 Step Challenge · v${CONFIG.VERSION}${DEMO ? ` · ${t('common.demoMode')}` : ''}</p>`;
}

/** Pending sign-in requests with the code to compare (approvals sheet, settings). */
export function requestList(list) {
  return `<ul class="req-list">${list.map(({ m, r }) => `
    <li class="req">
      <span class="req-who">${avatar(m, 40, { flagged: false })}<span><b>${esc(m.name)}</b><small>${esc(r.l || '?')} · ${ago(r.at)}</small></span></span>
      <span class="req-code" aria-label="${esc(t('req.code'))} ${codeOf(r.kid)}"><small>${t('req.code')}</small>${codeOf(r.kid)}</span>
      <span class="req-btns">
        <button class="btn sm ghost" data-action="deny" data-m="${esc(m.id)}" data-k="${esc(r.kid)}">${t('req.deny')}</button>
        <button class="btn sm" data-action="approve" data-m="${esc(m.id)}" data-k="${esc(r.kid)}">${icon('check', 16)} ${t('req.approve')}</button>
      </span>
    </li>`).join('')}</ul>`;
}

function devicesSection(st, me, captain) {
  const mine = captain ? [] : st.approvals.filter(a => a.m.id === me.id); // the captain sees them all below
  return section(t('settings.devices'), t('settings.devicesSub'), `
    <ul class="device-list">${(me.keys || []).map(k => {
      const here = k.kid === st.kid;
      return `<li><span class="device-ic">${icon('phone', 18)}</span><span class="device-name"><b>${esc(k.l || '?')}${here ? ` <em>${t('settings.thisDevice')}</em>` : ''}</b>
        <small>${t('settings.since', { date: k.at ? dateLabel(k.at.slice(0, 10)) : '—' })}</small></span>
        ${here ? '' : `<button class="btn sm ghost" data-action="revoke-device" data-k="${esc(k.kid)}">${t('settings.remove')}</button>`}</li>`;
    }).join('')}</ul>
    ${mine.length ? requestList(mine) : ''}`);
}

function captainSection(st) {
  const { members } = st.model;
  return section(t('admin.title'), t('admin.sub'), `
    ${st.approvals.length ? requestList(st.approvals) : `<p class="muted sm">${t('req.none')}</p>`}
    <ul class="captain-list">${members.map(m => `
      <li>${avatar(m, 34, { flagged: false })}<span class="device-name"><b>${esc(m.name)}</b>
        <small>${m.joined ? tn('admin.devices', (m.keys || []).length) : t('admin.notJoined')}${m.lastSyncAt ? ` · ${ago(m.lastSyncAt)}` : ''}</small></span>
        ${m.joined && m.id !== st.me.id ? `<button class="btn sm ghost" data-action="reset-member" data-id="${esc(m.id)}">${t('admin.reset')}</button>` : ''}</li>`).join('')}</ul>
    <div class="setting-row"><span>${icon('table', 18)} <span><b>${t('admin.sheet')}</b><br><small class="muted">${t('admin.sheetSub')}</small></span></span>
      <a class="btn sm ghost" href="${esc(CONFIG.SHEET_URL)}" target="_blank" rel="noopener">${icon('install', 16)} ${t('admin.download')}</a></div>`);
}

/* ════════════════════════════════ SYNC ════════════════════════════════ */
export function viewSync(st) {
  const me = st.model.me;
  const plat = st.platform;
  const link = st.me ? storedSyncLink(st.me.id) : '';
  const autoOn = me && me.autoSyncs > 0;
  const busy = st.syncBusy ? 'disabled' : '';
  const copyBtn = !st.me ? `<button class="btn sm" data-action="signin">${t('sync.signinLink')}</button>`
    : link ? `<button class="btn sm" data-action="copy-sync">${icon('copy', 16)} ${t('sync.copy')}</button>`
    : `<button class="btn sm ${st.syncBusy ? 'busy' : ''}" data-action="sync-create" ${busy}>${icon('bolt', 16)} ${t('sync.create')}</button>`;
  const linkBox = !st.me ? copyBtn : `
    ${link ? `<div class="linkbox"><code>${esc(link)}</code>${copyBtn}</div>` : `<div class="linkbox empty">${copyBtn}</div>`}
    ${!link && me && me.syncHash ? `<p class="muted sm">${t('sync.otherDevice')}</p>` : ''}
    <p class="muted sm">${t('sync.private')}${link ? ` <button class="link-btn inline" data-action="sync-new" ${busy}>${t('sync.newLink')}</button>` : ''}</p>`;
  const flowStep = (emoji, k, opt = false) => `<div class="flow-step ${opt ? 'opt' : ''}"><span>${emoji}</span><div><b>${t(`ios.${k}`)}</b>${opt ? ` <em>${t('common.optional')}</em>` : ''}<small>${t(`ios.${k}s`)}</small></div></div>`;

  const ios = `
    ${CONFIG.IOS_SHORTCUT_URL ? `
      <ol class="steps">
        <li><b>${t('ios.get')}</b><a class="btn sm" href="${esc(CONFIG.IOS_SHORTCUT_URL)}" target="_blank" rel="noopener">${icon('install', 16)} ${t('ios.add')}</a></li>
        <li><b>${t('ios.paste')}</b>${linkBox}</li>
        <li><b>${t('ios.runOnce')}</b>${t('ios.runOnceText')}</li>
      </ol>` : `
      <ol class="steps">
        <li><b>${t('ios.copyLink')}</b>${linkBox}</li>
        <li><b>${t('ios.create')}</b>${t('ios.createText')}
          <div class="flow">
            ${flowStep('❤️', 'f1')}${flowStep('∑', 'f2')}${flowStep('#', 'f3')}${flowStep('📝', 'f4')}${flowStep('🌐', 'f5')}${flowStep('🔔', 'f6', true)}
          </div>
          <p class="muted sm flow-tip">${t('ios.search')}</p></li>
        <li><b>${t('ios.name')}</b>${t('ios.runOnceText')}</li>
      </ol>`}
    <div class="callout"><b>${t('ios.auto')}</b>
      <ol><li>${t('ios.auto1')}</li><li>${t('ios.auto2')}</li><li>${t('ios.auto3')}</li></ol>
      <p class="muted sm">${t('ios.safe')}</p></div>`;

  const android = `
    <ol class="steps">
      <li><b>${t('and.install')}</b>${t('and.installText')}</li>
      <li><b>${t('and.shot')}</b>${t('and.shotText')}</li>
      <li><b>${t('and.share')}</b>${t('and.shareText')}</li>
    </ol>
    <button class="btn" data-action="ocr">${icon('camera', 18)} ${t('and.importNow')}</button>
    <details class="callout"><summary><b>${t('and.power')}</b></summary>
      <p>${t('and.powerText')}</p>
      ${linkBox}
      <p class="muted sm">${t('and.example')}</p></details>`;

  return `
  <div class="page-h"><h1>${t('sync.title')}</h1><p>${t('sync.sub')}</p></div>
  <section class="card sync-status ${autoOn ? 'on' : ''}">
    <span class="sync-emoji">${autoOn ? '🤖' : '⚡'}</span>
    <div>${!st.me ? `<b>${t('sync.signinTitle')}</b><p>${t('sync.signinText')}</p>`
      : autoOn ? `<b>${t('sync.onTitle')}</b><p>${tn('sync.onText', me.autoSyncs, { ago: ago(me.lastSyncAt), src: sourceLabel(me.lastSource) })}</p>`
      : `<b>${t('sync.offTitle')}</b><p>${t('sync.offText')}</p>`}</div>
    ${!st.me ? `<button class="btn sm" data-action="signin">${t('common.signin')}</button>` : ''}
  </section>

  ${section(t('sync.phone'), '', `${seg('platform', [['ios', '📱 iPhone'], ['android', '🤖 Android']], plat, t('sync.phoneAria'))}<div class="guide">${plat === 'ios' ? ios : android}</div>`)}

  ${section(t('rem.title'), t('rem.sub'), `
    <div class="btn-row wrap">
      <a class="btn ghost" href="assets/reminder.ics" download="team8-step-reminder.ics">${icon('calendar', 18)} Apple / Outlook</a>
      <a class="btn ghost" href="${gcalUrl(st.model.ctx)}" target="_blank" rel="noopener">${icon('calendar', 18)} Google Calendar</a>
    </div>`)}

  ${section(t('inst.title'), isStandalone() ? t('inst.installed') : t('inst.sub'), isStandalone() ? '' : `
    ${isIOS() ? `<ol class="steps compact"><li>${t('inst.ios1')}</li><li>${t('inst.ios2', { icon: icon('share', 16) })}</li><li>${t('inst.ios3')}</li></ol>`
      : `${st.canInstall ? `<button class="btn" data-action="install">${icon('install', 18)} ${t('inst.now')}</button>` : ''}
        <ol class="steps compact"><li>${t('inst.and1')}</li><li>${t('inst.and2')}</li></ol>`}`)}

  ${section(t('calc.title'), t('calc.sub'), `
    <ul class="calc">
      <li>${t('calc.distance')}</li>
      <li>${t('calc.kcal')}</li>
      <li>${t('calc.time')}</li>
      <li>${t('calc.level')}</li>
      <li>${t('calc.avg')}</li>
      <li>${t('calc.privacy')}</li>
    </ul>
    <p class="muted sm">Team 8 Step Challenge · v${CONFIG.VERSION}${DEMO ? ` · ${t('common.demoMode')}` : ''}</p>`)}`;
}

function gcalUrl(ctx) {
  const d = ctx.start.replace(/-/g, '');
  const until = ctx.end.replace(/-/g, '');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: t('rem.gcalTitle'),
    details: t('rem.gcalDetails', { url: CONFIG.APP_URL }),
    dates: `${d}T210000/${d}T211000`,
    recur: `RRULE:FREQ=DAILY;UNTIL=${until}`,
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

/* ════════════════════════════════ Charts per page ════════════════════════════════ */
export function drawPage(st, root, mount) {
  const { ctx, team, members, me } = st.model;
  const dayLabels = ctx.dates.map(d => dateLabel(d, 'num'));
  const future = ctx.lastIdx + 1;
  const emph = ctx.status === 'live' ? [ctx.todayIdx] : [];
  const comingUp = i => `<div class="tip-h">${dateLabel(ctx.dates[i])}</div><div class="tip-muted">${t('tip.comingUp')}</div>`;

  root.querySelectorAll('[data-chart]').forEach(host => {
    const kind = host.dataset.chart;
    if (kind === 'worldmap') {
      W.attachMap(host, { members, goal: ctx.goal, idx: ctx.status === 'live' ? ctx.todayIdx : ctx.lastIdx, meId: me && me.id });
    } else if (kind === 'teamMain' && st.teamChart === 'daily') {
      mount(host, () => C.columnChart(host, {
        values: team.dailyTotals, xLabels: dayLabels, goal: team.dailyGoal, goalLabel: t('chart.goal', { v: compact(team.dailyGoal) }),
        emphasis: emph, futureFrom: future, labelIdx: emph, aria: t('chart.teamPerDay'),
        tip: i => i > ctx.lastIdx ? comingUp(i)
          : `<div class="tip-h">${dateLabel(ctx.dates[i])}${i === ctx.todayIdx ? t('tip.todaySuffix') : ''}</div>${C.tipRow(fmt(team.dailyTotals[i]), t('tip.teamSteps'), i === ctx.todayIdx ? 'k-emph' : 'k-series')}${C.tipRow(`${team.loggedCount[i]}/${team.M}`, t('tip.membersLogged'))}${team.avgLogged[i] != null ? C.tipRow(fmt(team.avgLogged[i]), t('tip.avgPerMember')) : ''}`,
      }));
    } else if (kind === 'teamMain') {
      mount(host, () => C.lineChart(host, {
        labels: ctx.dates.map(d => dateLabel(d, 'short')), aria: t('chart.cumAria'),
        series: [{ values: team.pace, cls: 'k-pace' }, { values: team.cumulative, cls: 'k-series', area: true, endLabel: true }],
        tip: i => `<div class="tip-h">${dateLabel(ctx.dates[i])}</div>${team.cumulative[i] != null ? C.tipRow(fmt(team.cumulative[i]), t('tip.teamTotal'), 'k-series') : ''}${C.tipRow(fmt(team.pace[i]), t('tip.goalPace'), 'k-pace')}`,
      }));
    } else if (kind === 'heatmap') {
      mount(host, () => C.heatmap(host, {
        members, dates: ctx.dates, goal: ctx.goal, lastIdx: ctx.lastIdx, todayIdx: ctx.todayIdx, meId: me && me.id,
        colorOf: avColor, dayLabel: d => dateLabel(d, 'dow'), numLabel: d => dateLabel(d, 'num'), aria: t('heat.cellsAria'),
        onMember: id => st.onMember(id),
        tip: (m, i) => `<div class="tip-h">${esc(m.first)} · ${dateLabel(ctx.dates[i])}</div>${i > ctx.lastIdx ? `<div class="tip-muted">${t('tip.comingUp')}</div>`
          : m.daily[i] == null ? `<div class="tip-muted">${t('heat.notLogged')}</div>` : C.tipRow(fmt(m.daily[i]), m.daily[i] >= ctx.goal ? t('tip.stepsGoal') : t('unit.steps'))}`,
      }));
    } else if (kind === 'meDaily' && me) {
      mount(host, () => C.columnChart(host, {
        values: me.daily, xLabels: dayLabels, goal: ctx.goal, emphasis: [...me.daily.keys()].filter(i => i <= ctx.lastIdx),
        forceLabels: emph, futureFrom: future, labelIdx: me.s.bestIdx >= 0 ? [me.s.bestIdx] : [], aria: t('me.dailyAria'),
        line: { values: team.avgLogged, cls: 'k-context' },
        tip: i => i > ctx.lastIdx ? comingUp(i)
          : `<div class="tip-h">${dateLabel(ctx.dates[i])}</div>${C.tipRow(C.fmtSteps(me.daily[i]), t('tip.you'), 'k-emph')}${C.tipRow(C.fmtSteps(team.avgLogged[i]), t('tip.teamAvg'), 'k-context')}`,
      }));
    } else if (kind === 'meDow' && me) {
      const vals = me.s.byDow.map(v => (v == null ? 0 : Math.round(v)));
      const bestDow = vals.indexOf(Math.max(...vals));
      const names = weekdays();
      mount(host, () => C.columnChart(host, {
        values: vals, xLabels: names, goal: ctx.goal, height: 180, emphasis: vals[bestDow] > 0 ? [bestDow] : [],
        labelIdx: vals[bestDow] > 0 ? [bestDow] : [], aria: t('me.dowAria'),
        tip: i => `<div class="tip-h">${names[i]}</div>${me.s.byDow[i] == null ? `<div class="tip-muted">${t('tip.noData')}</div>` : C.tipRow(fmt(me.s.byDow[i]), t('tip.avgSteps'), i === bestDow ? 'k-emph' : 'k-series')}`,
      }));
    }
  });
}

export function drawMemberChart(st, host, m) {
  const { ctx, team } = st.model;
  C.columnChart(host, {
    values: m.daily, xLabels: ctx.dates.map(d => dateLabel(d, 'num')), goal: ctx.goal, height: 170,
    emphasis: ctx.status === 'live' ? [ctx.todayIdx] : [], futureFrom: ctx.lastIdx + 1, aria: t('member.chartAria', { name: m.first }),
    line: { values: team.avgLogged, cls: 'k-context' },
    tip: i => i > ctx.lastIdx ? `<div class="tip-h">${dateLabel(ctx.dates[i])}</div><div class="tip-muted">${t('tip.comingUp')}</div>`
      : `<div class="tip-h">${dateLabel(ctx.dates[i])}</div>${C.tipRow(C.fmtSteps(m.daily[i]), m.first, 'k-series')}${C.tipRow(C.fmtSteps(team.avgLogged[i]), t('tip.teamAvg'), 'k-context')}`,
  });
}

export { flag };
