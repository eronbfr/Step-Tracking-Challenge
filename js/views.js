// Page views: Team dashboard · Ranking · Me (stats + health) · Auto-sync & settings.
import { CONFIG } from './config.js';
import * as M from './metrics.js';
import * as C from './charts.js';
import { DEMO, syncUrl } from './api.js';
import { esc, fmt, compact, pct, dist, duration, dateLabel, ago, avatar, avColor, flag, icon, ring } from './ui.js';

const SOURCE = { shortcut: 'iPhone Shortcut 🤖', app: 'the app', tasker: 'Android automation 🤖', android: 'Android automation 🤖' };
export const sourceLabel = s => SOURCE[s] || (s ? `${s} 🤖` : 'the app');
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /android/i.test(navigator.userAgent);

const section = (title, sub, body, { cls = '', actions = '', id = '' } = {}) => `
  <section class="card ${cls}" ${id ? `id="${id}"` : ''}>
    <header class="card-h"><div><h2>${title}</h2>${sub ? `<p class="card-sub">${sub}</p>` : ''}</div>${actions}</header>
    ${body}
  </section>`;

const seg = (action, items, active, label) => `<div class="seg" role="tablist" aria-label="${esc(label)}">${items.map(([k, t]) =>
  `<button role="tab" aria-selected="${k === active}" class="${k === active ? 'on' : ''}" data-action="${action}" data-k="${k}">${t}</button>`).join('')}</div>`;

const tableToggle = (k, on) => `<button class="link-btn" data-action="toggle-table" data-k="${k}">${icon('table', 16)} ${on ? 'Hide table' : 'View as table'}</button>`;

const kpi = (emoji, label, value, sub) => `<div class="kpi"><span class="kpi-ic" aria-hidden="true">${emoji}</span><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span><span class="kpi-sub">${sub}</span></div>`;

const statusPill = ctx =>
  ctx.status === 'live' ? `<span class="pill">Day ${ctx.dayNumber} of ${ctx.N}</span><span class="pill ghost">${ctx.daysLeft ? `${ctx.daysLeft} day${ctx.daysLeft > 1 ? 's' : ''} left` : 'Last day! 🏁'}</span>`
  : ctx.status === 'upcoming' ? `<span class="pill">Starts in ${ctx.daysToStart} day${ctx.daysToStart > 1 ? 's' : ''}</span><span class="pill ghost">${dateLabel(ctx.start, 'short')} – ${dateLabel(ctx.end, 'short')}</span>`
  : `<span class="pill">Challenge complete 🎉</span><span class="pill ghost">${ctx.N} days</span>`;

/* ════════════════════════════════ TEAM ════════════════════════════════ */
export function viewTeam(st) {
  const { ctx, team, members, me } = st.model;
  const foodOfDay = M.FOODS[Math.max(0, ctx.dayNumber) % M.FOODS.length];
  const units = st.profile.units;
  const remainingDays = ctx.N - ctx.complete;
  const gapPP = remainingDays > 0 ? (team.teamGoal - team.projected) / team.M / remainingDays : 0;
  const projection = ctx.status === 'upcoming' ? '⏳ Warm up those legs — the challenge starts soon!'
    : ctx.status === 'finished' ? `🏁 Final: ${fmt(team.total)} steps — ${pct(team.progress)} of the team goal. What a team!`
    : ctx.complete === 0 ? '👟 Day 1 — every step from today counts. Let\'s go, Team 8!'
    : team.projectedPct >= 1 ? `🚀 On track to beat the goal — projected ${compact(team.projected)} (${pct(team.projectedPct)}).`
    : `📈 Projected ${compact(team.projected)} (${pct(team.projectedPct)}). +${fmt(gapPP)} steps per person a day closes the gap.`;

  const todayIdx = ctx.status === 'live' ? ctx.todayIdx : ctx.lastIdx;
  const todayList = members.slice().sort((a, b) => (b.daily[todayIdx] ?? -1) - (a.daily[todayIdx] ?? -1));
  const showToday = todayIdx >= 0;

  return `
  <section class="hero" aria-label="Team progress">
    <div class="hero-top">${statusPill(ctx)}</div>
    <div class="hero-main">
      <div class="hero-ring">${ring(team.progress, { size: 132, stroke: 12, cls: 'on-dark', label: `${pct(team.progress)} of team goal` })}
        <div class="ring-center"><b>${pct(team.progress)}</b><small>of goal</small></div></div>
      <div class="hero-stats">
        <span class="hero-label">Team steps</span>
        <span class="hero-num" data-count="${team.total}">${fmt(team.total)}</span>
        <span class="hero-sub">Goal ${compact(team.teamGoal)} · ${team.M} × 10K × ${ctx.N} days</span>
      </div>
    </div>
    <div class="hero-chips">
      <span class="chip-glass">🔥 Today <b>${compact(team.today || 0)}</b></span>
      <span class="chip-glass">✅ <b>${team.goalToday}/${team.M}</b> at 10K</span>
      <span class="chip-glass">📝 <b>${team.loggedToday}/${team.M}</b> logged</span>
    </div>
    <p class="hero-foot">${projection}</p>
  </section>
  ${banners(st)}

  ${showToday ? section(ctx.status === 'live' ? 'Today' : 'Last day', `${dateLabel(ctx.dates[todayIdx])} · ${team.loggedCount[todayIdx]} of ${team.M} logged`, `
    <div class="mates">${todayList.map(m => {
      const v = m.daily[todayIdx];
      return `<button class="mate ${me && me.id === m.id ? 'me' : ''} ${v == null ? 'idle' : ''}" data-action="member" data-id="${esc(m.id)}" aria-label="${esc(m.name)}: ${v == null ? 'not logged' : `${fmt(v)} steps`}">
        <span class="mate-ring">${ring((v || 0) / ctx.goal, { size: 70, stroke: 6 })}${avatar(m, 50)}</span>
        <span class="mate-name">${esc(m.first)}${me && me.id === m.id ? ' · you' : ''}</span>
        <span class="mate-steps">${v == null ? 'not yet' : `${compact(v)}${v >= ctx.goal ? ' ✓' : ''}`}</span>
      </button>`;
    }).join('')}</div>`, { actions: me ? `<button class="btn sm" data-action="log">${icon('plus', 16)} Log</button>` : '' }) : ''}

  <div class="kpis">
    ${kpi('📏', 'Distance', dist(team.km, units).text, `≈ ${(team.km / 42.195).toFixed(1)} marathons`)}
    ${kpi('🔥', 'Active calories', `${compact(team.kcal)} kcal`, `≈ ${fmt(team.kcal / foodOfDay.kcal)} ${foodOfDay.name} ${foodOfDay.emoji}`)}
    ${kpi('⏱️', 'Walking time', duration(team.minutes), `${fmt(team.avgPerMember / 100)} min / person / day`)}
    ${kpi('🎯', '10K days', fmt(team.memberDayGoals), team.best ? `Best team day ${compact(team.best)}` : 'Be the first!')}
  </div>

  ${section('Team steps', st.teamChart === 'daily' ? 'Per day · today highlighted' : 'Running total vs. goal pace', `
    <div class="chart" data-chart="teamMain" aria-label="Team steps chart"></div>
    ${st.teamChart === 'total' ? `<div class="legend"><span><i class="lg-line k-series"></i>Team total</span><span><i class="lg-line k-pace"></i>Goal pace</span></div>`
      : `<div class="legend"><span><i class="lg-box k-series"></i>Team steps</span><span><i class="lg-box k-emph"></i>Today</span><span><i class="lg-dash"></i>Team goal ${compact(team.dailyGoal)}</span></div>`}
    <div class="card-foot">${tableToggle('team', st.tables.team)}</div>
    ${st.tables.team ? C.table(['Day', 'Team steps', 'Logged', 'Cumulative'], ctx.dates.slice(0, ctx.lastIdx + 1).map((d, i) =>
      [dateLabel(d), fmt(team.dailyTotals[i]), `${team.loggedCount[i]}/${team.M}`, fmt(team.cumulative[i])])) : ''}
  `, { cls: 'wide', actions: seg('team-chart', [['daily', 'Daily'], ['total', 'Total']], st.teamChart, 'Chart type') })}

  ${section('Who walked when', 'Every square is one day · tap for details', `
    <div class="chart heat" data-chart="heatmap" aria-label="Steps heatmap by member and day"></div>
    <div class="legend heat-legend"><span>Less</span>${[1, 2, 3, 4, 5, 6].map(b => `<i class="hl hc-${b}"></i>`).join('')}<span>More</span>
      <span class="sep"></span><span><i class="hl-dot"></i>10K+</span><span><i class="hl hc-n"></i>Not logged</span></div>
    <div class="card-foot">${tableToggle('heat', st.tables.heat)}</div>
    ${st.tables.heat ? C.table(['Day', ...members.map(m => m.first)], ctx.dates.slice(0, ctx.lastIdx + 1).map((d, i) =>
      [dateLabel(d, 'short'), ...members.map(m => C.fmtSteps(m.daily[i]))])) : ''}
  `, { cls: 'wide' })}

  ${expedition(st)}
  ${funFacts(st)}
  <p class="foot-note">${st.data && st.data.updatedAt ? `Updated ${ago(st.data.updatedAt)}` : ''} · Estimates use a 0.76 m stride, 70 kg and ~100 steps/min.
    <a href="#/sync" class="link">How we calculate</a></p>`;
}

function banners(st) {
  let out = '';
  if (DEMO) out += `<div class="banner demo">🧪 <span><b>Demo mode</b> · sample data${CONFIG.API_URL ? ' — remove <code>?demo</code> for real data' : ' until the backend is connected'}</span></div>`;
  if (st.pending) out += `<div class="banner warn">${icon('wifi', 18)} <span>${st.pending} entr${st.pending > 1 ? 'ies' : 'y'} saved offline — will sync when you're back online.</span></div>`;
  if (!isStandalone() && !st.installHidden) out += `<div class="banner install"><span class="banner-emoji">📲</span><span><b>Get the app</b><br>Add Team 8 Steps to your home screen.</span>
    <button class="btn sm" data-action="install">Install</button><button class="icon-btn" data-action="dismiss-install" aria-label="Dismiss">${icon('close', 18)}</button></div>`;
  if (!st.me && st.model.ctx.status !== 'finished') out += `<button class="banner join" data-action="signin"><span class="banner-emoji">👋</span><span><b>Are you on Team 8?</b><br>Pick your name to start logging steps.</span>${icon('chevron', 20)}</button>`;
  return out;
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
    return i >= 0 ? `Day ${i + 1}` : '';
  };
  const units = st.profile.units;
  return section('Team expedition 🗺️', `${dist(km, units).text} walked together · straight-line distances`, `
    ${next ? `<div class="exp-next">
        <span class="exp-emoji" aria-hidden="true">${next.emoji}</span>
        <div><b>Next: ${esc(next.name)}</b><span>${dist(next.km - km, units).text} to go · ${esc(next.note)}</span>
        <div class="bar"><i style="width:${Math.min(100, ((km - prevKm) / (next.km - prevKm)) * 100).toFixed(1)}%"></i></div></div>
      </div>` : `<div class="exp-next done"><span class="exp-emoji">🏆</span><div><b>Every milestone unlocked!</b><span>Team 8 is legendary.</span></div></div>`}
    <ol class="trail">${ms.map((x, k) => {
      const done = km >= x.km;
      return `<li class="${done ? 'done' : ''} ${k === nextIdx ? 'next' : ''}"><span class="trail-dot">${done ? icon('check', 14) : x.emoji}</span>
        <span class="trail-name">${esc(x.name)}<small>${esc(x.note)}</small></span>
        <span class="trail-km">${dist(x.km, units).text}${done ? `<small>${reachedDay(x.km)}</small>` : ''}</span></li>`;
    }).join('')}</ol>`, { cls: ctx.status === 'upcoming' ? 'muted-card' : '' });
}

function funFacts(st) {
  const { team } = st.model;
  const km = team.km;
  return section('Fun facts 🎉', 'What the team\'s steps add up to', `
    <div class="facts">
      <div class="fact"><span>🌍</span><p><b>${pct(km / M.EARTH_KM, 2)}</b> of the way around the Earth</p></div>
      <div class="fact"><span>🚗</span><p><b>${fmt(M.toCo2Kg(km))} kg CO₂</b> — what a car would emit driving the same distance</p></div>
      <div class="fact"><span>🧈</span><p><b>${(M.toFatGrams(team.kcal) / 1000).toFixed(1)} kg</b> of fat-energy burned (≈ ${fmt(team.kcal)} kcal)</p></div>
      <div class="fact"><span>🏟️</span><p><b>${fmt(km / 0.4)}</b> laps of a 400 m running track</p></div>
    </div>
    <p class="mini-h">Burned calories in regional favourites</p>
    <div class="foods">${M.FOODS.map(f => `<div class="food"><span>${f.emoji}</span><b>${fmt(team.kcal / f.kcal)}</b><small>${f.name}</small></div>`).join('')}</div>`);
}

/* ════════════════════════════════ RANKING ════════════════════════════════ */
const RANK = {
  total:  { label: 'Total',     unit: 'steps', get: s => s.total },
  week:   { label: 'This week', unit: 'steps', get: s => s.thisWeek },
  today:  { label: 'Today',     unit: 'steps', get: s => s.today || 0 },
  avg:    { label: 'Daily avg', unit: 'steps/day', get: s => Math.round(s.avg) },
  goals:  { label: '10K days',  unit: 'days', get: s => s.goalDays },
  streak: { label: 'Streak',    unit: 'days 🔥', get: s => s.current },
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
  const fmtV = v => (R.unit.startsWith('steps') ? fmt(v) : v);

  const podium = leader > 0 ? `<div class="podium">${[1, 0, 2].map(k => {
      const r = ranked[k];
      if (!r) return '<div></div>';
      return `<button class="podium-col p${k + 1}" data-action="member" data-id="${esc(r.m.id)}">
        <span class="podium-medal">${medal[r.place - 1] || ''}</span>${avatar(r.m, k === 0 ? 68 : 56)}
        <span class="podium-name">${esc(r.m.first)}</span><span class="podium-val">${R.unit.startsWith('steps') ? compact(r.v) : r.v}</span>
        <span class="podium-base">${r.place}</span></button>`;
    }).join('')}</div>`
    : `<div class="empty">🏁<p><b>The podium is waiting…</b><br>Log your first steps to claim it!</p></div>`;

  return `
  <div class="page-h"><h1>Ranking</h1><p>Everyone who moves wins 💙 — rankings are just for fun.</p></div>
  <div class="chips-scroll">${seg('rank-by', Object.entries(RANK).map(([k, r]) => [k, r.label]), st.rankBy, 'Ranking metric')}</div>
  ${podium}
  <ol class="board" aria-label="Ranking by ${esc(R.label)}">${ranked.map(({ m, v, place }) => `
    <li><button class="row ${me && me.id === m.id ? 'me' : ''}" data-action="member" data-id="${esc(m.id)}">
      <span class="row-rank">${place <= 3 && leader > 0 ? medal[place - 1] : place}</span>
      ${avatar(m, 42)}
      <span class="row-main"><span class="row-name">${esc(m.name)}${me && me.id === m.id ? ' <em>you</em>' : ''}</span>
        <span class="row-sub">${m.s.level.emoji} ${m.s.level.name} · 🏅 ${m.badgeCount}${m.s.current >= 2 ? ` · 🔥 ${m.s.current}` : ''}</span>
        <span class="row-bar"><i style="width:${leader ? ((v / leader) * 100).toFixed(1) : 0}%"></i></span></span>
      <span class="row-spark">${C.miniBars(last7(m), ctx.goal)}</span>
      <span class="row-val"><b>${fmtV(v)}</b><small>${R.unit}</small></span>
    </button></li>`).join('')}
  </ol>
  ${hof.length ? `<div class="page-h sm"><h2>Hall of fame</h2></div><div class="hof">${hof.map(h => `
    <button class="hof-card" data-action="member" data-id="${esc(h.m.id)}">
      <span class="hof-emoji">${h.emoji}</span><span class="hof-title">${h.title}</span>
      <span class="hof-who">${avatar(h.m, 28, { flagged: false })}<b>${esc(h.m.first)}</b></span>
      <span class="hof-val">${h.pct ? `+${h.value}` : fmt(h.value)} <small>${h.unit}${h.note ? ` · ${dateLabel(h.note, 'short')}` : ''}</small></span>
    </button>`).join('')}</div>` : ''}`;
}

/* ════════════════════════════════ ME ════════════════════════════════ */
const INSIGHTS = [
  { emoji: '🎯', title: 'The 8–10K sweet spot', src: 'Paluch et al., The Lancet Public Health, 2022',
    body: 'Pooling 15 studies of 47,000+ adults, the lower risk of early death levelled off around 8,000–10,000 steps a day for adults under 60 (6,000–8,000 for 60+).',
    you: s => (s.avg < 1 ? '' : s.avg < 8000 ? `You average ${fmt(s.avg)} — ${fmt(8000 - s.avg)} more a day reaches the sweet spot.` : s.avg <= 10000 ? 'You are right in the sweet spot ✅' : 'You are above it — extra steps keep building fitness 💪') },
  { emoji: '❤️', title: 'Every 1,000 steps counts', src: 'Banach et al., European Journal of Preventive Cardiology, 2023',
    body: 'Each extra 1,000 steps a day was associated with a 15% lower risk of death from any cause, and +500 steps with 7% lower cardiovascular mortality.',
    you: s => (s.avg >= 1 ? `A 10-minute walk ≈ 1,000 steps. Your best day was ${fmt(s.best)}.` : '') },
  { emoji: '🧠', title: 'Good for your brain', src: 'del Pozo Cruz et al., JAMA Neurology, 2022',
    body: 'About 9,800 steps a day was associated with ~50% lower dementia risk; even ~3,800 steps a day with ~25% lower risk.',
    you: () => '' },
  { emoji: '⏱️', title: '150 minutes a week', src: 'World Health Organization guidelines, 2020',
    body: 'Adults should get 150–300 minutes of moderate activity every week. Brisk walking counts!',
    you: s => `This week: ~${fmt(s.weekActive)} of 150 min of brisk walking (est.).` },
];

export function viewMe(st) {
  const { me, ctx, team } = st.model;
  if (!me) return `
    <div class="page-h"><h1>Me</h1></div>
    <section class="card center-card"><div class="big-emoji">👟</div><h2>Join the challenge</h2>
      <p class="muted">Pick your name and create a PIN to log steps, earn badges and see your health stats.</p>
      <button class="btn lg" data-action="signin">Pick my name</button></section>
    ${settingsCard(st)}`;

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
    ${avatar(me, 64)}
    <div class="me-id"><h1>${esc(me.name)}</h1>
      <p><span class="tag">${level.emoji} ${level.name}</span><span class="tag">#${me.rank} of ${team.M}</span><span class="tag">🏅 ${earned}/${me.badges.length}</span></p>
      <p class="muted sm">${me.lastSyncAt ? `Last update ${ago(me.lastSyncAt)} via ${sourceLabel(me.lastSource)}` : 'No steps logged yet'}</p></div>
  </section>

  <section class="card today-me">
    <div class="today-ring">${ring(today / ctx.goal, { size: 176, stroke: 16, cls: 'big', label: `${fmt(today)} of ${fmt(ctx.goal)} steps today` })}
      <div class="ring-center"><small>${ctx.status === 'live' ? 'Today' : 'Last day'}</small><b data-count="${today}">${fmt(today)}</b><small>of ${fmt(ctx.goal)}</small></div></div>
    <p class="today-msg">${ctx.status !== 'live' ? '' : s.today == null ? 'Nothing logged today yet — let\'s change that! 👟'
      : toGo ? `<b>${fmt(toGo)}</b> to go — about ${Math.ceil(toGo / 100)} min of walking 🚶` : `Goal crushed! <b>+${fmt(today - ctx.goal)}</b> extra 🎉`}</p>
    <div class="btn-row"><button class="btn" data-action="log">${icon('plus', 18)} Log steps</button><a class="btn ghost" href="#/sync">${icon('bolt', 18)} Auto-sync</a></div>
  </section>

  <div class="stat-grid">
    ${stat('Total steps', fmt(s.total), `${pct(s.pctTarget)} of ${compact(ctx.target)}`)}
    ${stat('Daily average', fmt(s.avg), ctx.complete ? `over ${ctx.complete} full day${ctx.complete > 1 ? 's' : ''}` : 'today so far')}
    ${stat('Best day', s.best ? fmt(s.best) : '—', s.bestIdx >= 0 ? dateLabel(ctx.dates[s.bestIdx]) : 'Waiting for you')}
    ${stat('Current streak', `${s.current} 🔥`, `Longest: ${s.longest} day${s.longest === 1 ? '' : 's'}`)}
    ${stat('10K days', `${s.goalDays}`, `of ${Math.max(1, ctx.lastIdx + 1)} so far`)}
    ${stat('Consistency', s.consistency == null ? '—' : pct(s.consistency), `${s.logged} day${s.logged === 1 ? '' : 's'} logged`)}
    ${stat('Projected finish', compact(s.projected), `at your current pace`)}
    ${stat('Needed per day', s.remaining ? fmt(s.need) : '—', s.remaining ? `to reach ${compact(ctx.target)}` : 'Challenge over')}
  </div>

  ${section('Your daily steps', 'You vs. the team average', `
    <div class="chart" data-chart="meDaily" aria-label="Your daily steps"></div>
    <div class="legend"><span><i class="lg-box k-emph"></i>You</span><span><i class="lg-line k-context"></i>Team average</span><span><i class="lg-dash"></i>Goal 10K</span></div>
    <div class="card-foot">${tableToggle('me', st.tables.me)}</div>
    ${st.tables.me ? C.table(['Day', 'You', 'Team avg'], ctx.dates.slice(0, ctx.lastIdx + 1).map((d, i) => [dateLabel(d), C.fmtSteps(me.daily[i]), C.fmtSteps(team.avgLogged[i])])) : ''}`, { cls: 'wide' })}

  ${section('Your week rhythm', s.weekdayAvg != null ? `Weekdays ${fmt(s.weekdayAvg)} · Weekends ${s.weekendAvg != null ? fmt(s.weekendAvg) : '—'}` : 'Fills in as the days go by', `
    <div class="chart" data-chart="meDow" aria-label="Average steps by weekday"></div>`)}

  ${section('Health metrics ❤️', p.heightCm || p.weightKg ? 'Personalized with your height & weight' : 'Using averages — personalize below for accuracy', `
    <div class="health-grid">
      ${health('📏', 'Distance', dist(s.km, units).text, `${(M.strideM(p) * 100).toFixed(0)} cm stride`)}
      ${health('🔥', 'Active calories', `${fmt(s.kcal)} kcal`, `≈ ${fmt(s.kcal / 170)} tacos 🌮`)}
      ${health('⏱️', 'Walking time', duration(s.minutes), `≈ ${fmt(s.avg / 100)} min a day`)}
      ${health('🧈', 'Fat-energy', `${fmt(M.toFatGrams(s.kcal))} g`, 'equivalent burned')}
      ${health('🌿', 'CO₂ avoided', `${fmt(M.toCo2Kg(s.km))} kg`, 'vs. driving it')}
      ${bmi ? health('⚖️', 'BMI', bmi.toFixed(1), M.bmiClass(bmi)) : health('⚖️', 'BMI', '—', 'Add height & weight')}
    </div>
    <div class="who">
      ${ring(s.weekActive / 150, { size: 84, stroke: 9, label: 'Weekly brisk walking vs WHO 150 minutes' })}
      <div><b>WHO weekly activity</b><p>~${fmt(s.weekActive)} of 150 min of brisk walking this week. ${s.weekActive >= 150 ? 'Target reached ✅' : `${fmt(150 - s.weekActive)} min to go.`}</p>
      <p class="muted sm">Estimated from steps above a 5K/day baseline at ~100 steps/min.</p></div>
    </div>
    <div class="levels" aria-label="Activity level">
      <p class="level-h">Activity level: <b>${level.emoji} ${level.name}</b> · ${fmt(s.avg)} steps/day</p>
      <div class="level-track">${M.LEVELS.map(l => `<span class="${l === level ? 'on' : ''}">${l.emoji}</span>`).join('')}<i class="level-marker" style="left:${levelPos.toFixed(1)}%"></i></div>
      <div class="level-scale"><span>0</span><span>5K</span><span>7.5K</span><span>10K</span><span>12.5K+</span></div>
      <p class="muted sm">${level.tip} · Classification: Tudor-Locke & Bassett, 2004.</p>
    </div>`)}

  ${section('What the science says 🔬', 'Population studies show associations, not guarantees', `
    <div class="insights">${INSIGHTS.map(x => { const you = x.you(s); return `<article class="insight"><span class="insight-emoji">${x.emoji}</span><div><h3>${x.title}</h3><p>${x.body}</p>${you ? `<p class="insight-you">${you}</p>` : ''}<cite>${x.src}</cite></div></article>`; }).join('')}</div>
    <p class="muted sm">Not medical advice. Check with your doctor before big changes in activity.</p>`)}

  ${section(`Badges · ${earned}/${me.badges.length}`, 'Tap the + to log steps and unlock more', `
    <div class="badges">${me.badges.map(b => `<div class="badge ${b.earned ? 'earned' : ''}" title="${esc(b.desc)}">
      <span class="badge-emoji">${b.emoji}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small>
      ${b.earned ? '' : `<span class="bar thin"><i style="width:${(b.progress * 100).toFixed(0)}%"></i></span>`}</div>`).join('')}</div>`)}

  ${settingsCard(st)}`;
}

const stat = (label, value, sub) => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span><span class="stat-sub">${sub}</span></div>`;
const health = (emoji, label, value, sub) => `<div class="hm"><span class="hm-ic">${emoji}</span><span class="hm-label">${label}</span><b>${value}</b><small>${sub}</small></div>`;

function settingsCard(st) {
  const p = st.profile;
  return section('Settings ⚙️', 'Height & weight stay on this device', `
    <form class="form" data-form="profile">
      <label>Height <span class="input-unit"><input name="heightCm" type="number" inputmode="numeric" min="120" max="230" placeholder="175" value="${p.heightCm || ''}"><i>cm</i></span></label>
      <label>Weight <span class="input-unit"><input name="weightKg" type="number" inputmode="decimal" min="35" max="250" step="0.1" placeholder="70" value="${p.weightKg || ''}"><i>kg</i></span></label>
      <label>Distance units <select name="units"><option value="metric" ${p.units !== 'imperial' ? 'selected' : ''}>Kilometers</option><option value="imperial" ${p.units === 'imperial' ? 'selected' : ''}>Miles</option></select></label>
      <button class="btn" type="submit">${icon('check', 18)} Save</button>
    </form>
    <div class="setting-row"><span>${icon('moon', 18)} Appearance</span>${seg('theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], st.theme, 'Theme')}</div>
    <div class="setting-row"><span>${icon('share', 18)} Invite a teammate</span><button class="btn sm ghost" data-action="share-app">Share link</button></div>
    ${st.me ? `<div class="setting-row"><span>${icon('logout', 18)} Signed in as <b>${esc(st.model.me ? st.model.me.first : st.me.id)}</b></span><button class="btn sm ghost" data-action="signout">Sign out</button></div>` : ''}`);
}

/* ════════════════════════════════ SYNC ════════════════════════════════ */
export function viewSync(st) {
  const me = st.model.me;
  const plat = st.platform;
  const link = st.me ? syncUrl(st.me.id, st.me.token) : '';
  const autoOn = me && me.autoSyncs > 0;
  const copyBtn = st.me ? `<button class="btn sm" data-action="copy-sync">${icon('copy', 16)} Copy my link</button>` : `<button class="btn sm" data-action="signin">Sign in to get your link</button>`;
  const linkBox = st.me ? `<div class="linkbox"><code>${esc(link)}</code>${copyBtn}</div><p class="muted sm">🔒 This link is personal — it can only update <b>your</b> steps. Don't share it.</p>` : copyBtn;

  const ios = `
    ${CONFIG.IOS_SHORTCUT_URL ? `
      <ol class="steps">
        <li><b>Get the Team 8 Shortcut</b><a class="btn sm" href="${esc(CONFIG.IOS_SHORTCUT_URL)}" target="_blank" rel="noopener">${icon('install', 16)} Add Shortcut</a></li>
        <li><b>When it asks for your link, paste it</b>${linkBox}</li>
        <li><b>Run it once</b>Tap ▶︎ and <b>Allow</b> access to Health — you should see “✅ … steps saved”.</li>
      </ol>` : `
      <ol class="steps">
        <li><b>Copy your personal sync link</b>${linkBox}</li>
        <li><b>Create the shortcut</b>Open the <b>Shortcuts</b> app → <b>+</b> and add these actions:
          <div class="flow">
            <div class="flow-step"><span>❤️</span><div><b>Find Health Samples</b><small>Type <i>is</i> Steps · Start Date <i>is today</i> · Group by <i>Day</i></small></div></div>
            <div class="flow-step"><span>∑</span><div><b>Calculate Statistics</b><small><i>Sum</i> of Health Samples</small></div></div>
            <div class="flow-step"><span>#</span><div><b>Round Number</b><small>to <i>Ones Place</i></small></div></div>
            <div class="flow-step"><span>📝</span><div><b>Text</b><small>Paste your link, then insert the <i>Rounded Number</i> variable at the very end</small></div></div>
            <div class="flow-step"><span>🌐</span><div><b>Get Contents of URL</b><small>URL: the <i>Text</i> above</small></div></div>
            <div class="flow-step opt"><span>🔔</span><div><b>Show Notification</b> <em>optional</em><small>Contents of URL → shows "✅ … steps saved"</small></div></div>
          </div></li>
        <li><b>Name it “Team 8 Sync” and run it once</b>Tap ▶︎ and <b>Allow</b> access to Health — you should see “✅ … steps saved”.</li>
      </ol>`}
    <div class="callout"><b>⏰ Make it automatic</b>
      <ol><li>Shortcuts → <b>Automation</b> → <b>+</b> → <b>Time of Day</b></li>
      <li>Pick <b>12:00</b>, <b>Daily</b>, select <b>Run Immediately</b> → choose <b>Team 8 Sync</b></li>
      <li>Repeat for <b>18:00</b> and <b>23:30</b>. Done — your steps now update by themselves 🤖</li></ol>
      <p class="muted sm">Running several times a day is safe: automatic syncs never lower a day's value.</p></div>`;

  const android = `
    <ol class="steps">
      <li><b>Install this app</b>Add it to your home screen (see “Install the app” below) — that puts it in Android's share menu.</li>
      <li><b>Screenshot your health app</b>Open Samsung Health, Google Fit, Fitbit, Garmin… and take a screenshot of today's steps.</li>
      <li><b>Share it to “Team 8 Steps”</b>The app reads the number for you — just check it and tap Save. 📷✨</li>
    </ol>
    <button class="btn" data-action="ocr">${icon('camera', 18)} Import a screenshot now</button>
    <details class="callout"><summary><b>🤖 Power users: full automation</b></summary>
      <p>Apps like <b>Tasker</b>, <b>MacroDroid</b> or <b>HTTP Shortcuts</b> can read your step count and open your personal link with the steps added at the end — on a schedule.</p>
      ${linkBox}
      <p class="muted sm">Example: <code>…&amp;steps=8432</code>. Add <code>&amp;date=2026-10-21</code> to send a specific day.</p></details>`;

  return `
  <div class="page-h"><h1>Auto-sync ⚡</h1><p>Set it once, never type your steps again.</p></div>
  <section class="card sync-status ${autoOn ? 'on' : ''}">
    <span class="sync-emoji">${autoOn ? '🤖' : '⚡'}</span>
    <div>${!st.me ? '<b>Sign in to set up auto-sync</b><p>You\'ll get a personal sync link for your phone.</p>'
      : autoOn ? `<b>Auto-sync is on</b><p>Last update ${ago(me.lastSyncAt)} via ${sourceLabel(me.lastSource)} · ${me.autoSyncs} automatic sync${me.autoSyncs > 1 ? 's' : ''}</p>`
      : '<b>Auto-sync is not set up yet</b><p>It takes about 2 minutes. Pick your phone below.</p>'}</div>
    ${!st.me ? `<button class="btn sm" data-action="signin">Sign in</button>` : ''}
  </section>

  ${section('Your phone', '', `${seg('platform', [['ios', '📱 iPhone'], ['android', '🤖 Android']], plat, 'Phone type')}<div class="guide">${plat === 'ios' ? ios : android}</div>`)}

  ${section('Daily reminder ⏰', 'A 9 PM calendar nudge until the challenge ends', `
    <div class="btn-row wrap">
      <a class="btn ghost" href="assets/reminder.ics" download="team8-step-reminder.ics">${icon('calendar', 18)} Apple / Outlook</a>
      <a class="btn ghost" href="${gcalUrl(st.model.ctx)}" target="_blank" rel="noopener">${icon('calendar', 18)} Google Calendar</a>
    </div>`)}

  ${section('Install the app 📲', isStandalone() ? 'Installed — you are using the app version ✅' : 'Works offline and opens full-screen like a native app', isStandalone() ? '' : `
    ${isIOS() ? `<ol class="steps compact"><li>Open this page in <b>Safari</b></li><li>Tap <b>Share</b> ${icon('share', 16)} → <b>Add to Home Screen</b></li><li>Tap <b>Add</b> — done!</li></ol>`
      : `${st.canInstall ? `<button class="btn" data-action="install">${icon('install', 18)} Install now</button>` : ''}
        <ol class="steps compact"><li>Open this page in <b>Chrome</b></li><li>Tap the menu <b>⋮</b> → <b>Install app</b> / <b>Add to Home screen</b></li></ol>`}`)}

  ${section('How we calculate 🧮', 'Every health number is an estimate from your steps', `
    <ul class="calc">
      <li><b>Distance</b> = steps × stride. Stride = 41.4% of your height (default 0.76 m).</li>
      <li><b>Active calories</b> = 2.5 MET × weight × walking hours (brisk walking ≈ 3.5 MET minus rest). Default weight 70 kg.</li>
      <li><b>Walking time</b> ≈ steps ÷ 100 steps/min (moderate-intensity cadence). For the WHO 150-min goal we only count steps above a 5K/day baseline of everyday movement.</li>
      <li><b>Activity level</b>: Tudor-Locke & Bassett (2004) — Sedentary &lt;5K · Low 5–7.5K · Somewhat active 7.5–10K · Active 10–12.5K · Highly active 12.5K+.</li>
      <li><b>Averages</b> use full days only, so a half-synced “today” never drags them down.</li>
      <li><b>Privacy</b>: names and step counts are visible to the team. Your PIN is stored as a salted hash. Height & weight never leave your phone.</li>
    </ul>
    <p class="muted sm">Team 8 Step Challenge · v${CONFIG.VERSION}${DEMO ? ' · demo mode' : ''}</p>`)}`;
}

function gcalUrl(ctx) {
  const d = ctx.start.replace(/-/g, '');
  const until = ctx.end.replace(/-/g, '');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: '👟 Log your steps — Team 8',
    details: `Open the app and log today's steps: ${CONFIG.APP_URL}`,
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

  root.querySelectorAll('[data-chart]').forEach(host => {
    const kind = host.dataset.chart;
    if (kind === 'teamMain' && st.teamChart === 'daily') {
      mount(host, () => C.columnChart(host, {
        values: team.dailyTotals, xLabels: dayLabels, goal: team.dailyGoal, goalLabel: `Goal ${compact(team.dailyGoal)}`,
        emphasis: emph, futureFrom: future, labelIdx: emph, aria: 'Team steps per day',
        tip: i => i > ctx.lastIdx ? `<div class="tip-h">${dateLabel(ctx.dates[i])}</div><div class="tip-muted">Coming up</div>`
          : `<div class="tip-h">${dateLabel(ctx.dates[i])}${i === ctx.todayIdx ? ' · today' : ''}</div>${C.tipRow(fmt(team.dailyTotals[i]), 'team steps', i === ctx.todayIdx ? 'k-emph' : 'k-series')}${C.tipRow(`${team.loggedCount[i]}/${team.M}`, 'members logged')}${team.avgLogged[i] != null ? C.tipRow(fmt(team.avgLogged[i]), 'avg per member') : ''}`,
      }));
    } else if (kind === 'teamMain') {
      mount(host, () => C.lineChart(host, {
        labels: ctx.dates.map(d => dateLabel(d, 'short')), aria: 'Cumulative team steps vs goal pace',
        series: [{ values: team.pace, cls: 'k-pace' }, { values: team.cumulative, cls: 'k-series', area: true, endLabel: true }],
        tip: i => `<div class="tip-h">${dateLabel(ctx.dates[i])}</div>${team.cumulative[i] != null ? C.tipRow(fmt(team.cumulative[i]), 'team total', 'k-series') : ''}${C.tipRow(fmt(team.pace[i]), 'goal pace', 'k-pace')}`,
      }));
    } else if (kind === 'heatmap') {
      mount(host, () => C.heatmap(host, {
        members, dates: ctx.dates, goal: ctx.goal, lastIdx: ctx.lastIdx, todayIdx: ctx.todayIdx, meId: me && me.id,
        colorOf: avColor, dayLabel: d => dateLabel(d, 'dow'), numLabel: d => dateLabel(d, 'num'), aria: 'Daily steps for each member',
        onMember: id => st.onMember(id),
        tip: (m, i) => `<div class="tip-h">${esc(m.first)} · ${dateLabel(ctx.dates[i])}</div>${i > ctx.lastIdx ? '<div class="tip-muted">Coming up</div>'
          : m.daily[i] == null ? '<div class="tip-muted">Not logged</div>' : C.tipRow(fmt(m.daily[i]), m.daily[i] >= ctx.goal ? 'steps · goal ✓' : 'steps')}`,
      }));
    } else if (kind === 'meDaily' && me) {
      mount(host, () => C.columnChart(host, {
        values: me.daily, xLabels: dayLabels, goal: ctx.goal, emphasis: [...me.daily.keys()].filter(i => i <= ctx.lastIdx),
        forceLabels: emph, futureFrom: future, labelIdx: me.s.bestIdx >= 0 ? [me.s.bestIdx] : [], aria: 'Your daily steps vs team average',
        line: { values: team.avgLogged, cls: 'k-context' },
        tip: i => i > ctx.lastIdx ? `<div class="tip-h">${dateLabel(ctx.dates[i])}</div><div class="tip-muted">Coming up</div>`
          : `<div class="tip-h">${dateLabel(ctx.dates[i])}</div>${C.tipRow(C.fmtSteps(me.daily[i]), 'you', 'k-emph')}${C.tipRow(C.fmtSteps(team.avgLogged[i]), 'team avg', 'k-context')}`,
      }));
    } else if (kind === 'meDow' && me) {
      const vals = me.s.byDow.map(v => (v == null ? 0 : Math.round(v)));
      const bestDow = vals.indexOf(Math.max(...vals));
      const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      mount(host, () => C.columnChart(host, {
        values: vals, xLabels: names, goal: ctx.goal, height: 180, emphasis: vals[bestDow] > 0 ? [bestDow] : [],
        labelIdx: vals[bestDow] > 0 ? [bestDow] : [], aria: 'Average steps by weekday',
        tip: i => `<div class="tip-h">${names[i]}</div>${me.s.byDow[i] == null ? '<div class="tip-muted">No data yet</div>' : C.tipRow(fmt(me.s.byDow[i]), 'average steps', i === bestDow ? 'k-emph' : 'k-series')}`,
      }));
    }
  });
}

export function drawMemberChart(st, host, m) {
  const { ctx, team } = st.model;
  C.columnChart(host, {
    values: m.daily, xLabels: ctx.dates.map(d => dateLabel(d, 'num')), goal: ctx.goal, height: 170,
    emphasis: ctx.status === 'live' ? [ctx.todayIdx] : [], futureFrom: ctx.lastIdx + 1, aria: `${m.first}'s daily steps`,
    line: { values: team.avgLogged, cls: 'k-context' },
    tip: i => i > ctx.lastIdx ? `<div class="tip-h">${dateLabel(ctx.dates[i])}</div><div class="tip-muted">Coming up</div>`
      : `<div class="tip-h">${dateLabel(ctx.dates[i])}</div>${C.tipRow(C.fmtSteps(m.daily[i]), m.first, 'k-series')}${C.tipRow(C.fmtSteps(team.avgLogged[i]), 'team avg', 'k-context')}`,
  });
}

export { flag };
