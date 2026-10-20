// Challenge & health metrics — pure functions, no DOM.
// All health numbers are estimates derived from step counts; the formulas are documented in docs/METRICS.md.

export const DEFAULTS = { strideM: 0.762, weightKg: 70 };
const STEPS_PER_MIN = 100;   // ≈ moderate-intensity walking cadence (Tudor-Locke et al., 2018)
const NET_MET = 2.5;         // brisk walking ≈ 3.5 MET minus 1 MET at rest → "active" calories
const KCAL_PER_KG_FAT = 7700;
const CO2_KG_PER_KM = 0.15;  // average passenger car
export const EARTH_KM = 40075;
export const SWEET_SPOT = [8000, 10000]; // Paluch et al., Lancet Public Health 2022 (adults < 60)

/* ── Dates (local calendar days as yyyy-mm-dd strings) ── */
const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
export const dow = s => parseISO(s).getDay(); // 0 = Sunday
export const monIdx = s => (dow(s) + 6) % 7;  // 0 = Monday
export function datesBetween(a, b) { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; }
const mondayOf = s => addDays(s, -monIdx(s));

/* ── Health conversions ── */
export const strideM = p => (p && p.heightCm ? (p.heightCm * 0.414) / 100 : DEFAULTS.strideM);
export const weightKg = p => (p && p.weightKg) || DEFAULTS.weightKg;
export const toKm = (steps, p) => (steps * strideM(p)) / 1000;
export const toMinutes = steps => steps / STEPS_PER_MIN;
export const toKcal = (steps, p) => NET_MET * weightKg(p) * (steps / STEPS_PER_MIN / 60);
export const toFatGrams = kcal => (kcal / KCAL_PER_KG_FAT) * 1000;
export const toCo2Kg = km => km * CO2_KG_PER_KM;
export const bmiOf = p => (p && p.heightCm && p.weightKg ? p.weightKg / (p.heightCm / 100) ** 2 : null);
export function bmiClass(b) {
  if (b == null) return null;
  if (b < 18.5) return 'Underweight';
  if (b < 25) return 'Healthy range';
  if (b < 30) return 'Overweight';
  return 'Obesity range';
}

// Tudor-Locke & Bassett (2004) pedometer-based activity classification
export const LEVELS = [
  { min: 0,     name: 'Sedentary',       emoji: '🛋️', tip: 'Short walks after meals add up fast.' },
  { min: 5000,  name: 'Low active',      emoji: '🚶', tip: 'A 15-minute walk at lunch adds ~1,500 steps.' },
  { min: 7500,  name: 'Somewhat active', emoji: '🙂', tip: 'You are close — 10K is within reach!' },
  { min: 10000, name: 'Active',          emoji: '💪', tip: 'This is the classic 10K target. Keep it up!' },
  { min: 12500, name: 'Highly active',   emoji: '🚀', tip: 'Elite territory. Remember to recover well.' },
];
export const levelOf = avg => LEVELS.slice().reverse().find(l => avg >= l.min);

// Approximate energy of regional favourites (kcal per unit)
export const FOODS = [
  { emoji: '🌮', name: 'tacos', one: 'taco', kcal: 170 },
  { emoji: '🫓', name: 'arepas', one: 'arepa', kcal: 220 },
  { emoji: '🥟', name: 'empanadas', one: 'empanada', kcal: 280 },
  { emoji: '🍫', name: 'brigadeiros', one: 'brigadeiro', kcal: 100 },
  { emoji: '🍪', name: 'alfajores', one: 'alfajor', kcal: 220 },
  { emoji: '🍕', name: 'pizza slices', one: 'pizza slice', kcal: 285 },
];

/* ── Team expedition: straight-line distances between team home cities ── */
const CITY = {
  rio: [-22.9068, -43.1729], sp: [-23.5505, -46.6333], mvd: [-34.9011, -56.1645], pde: [-34.9667, -54.95],
  bog: [4.711, -74.0721], med: [6.2442, -75.5812], cdmx: [19.4326, -99.1332], aca: [16.8531, -99.8237],
};
function haversine([la1, lo1], [la2, lo2]) {
  const r = Math.PI / 180;
  const a = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}
const hv = (a, b) => Math.round(haversine(CITY[a], CITY[b]));
export const MILESTONES = [
  { km: 42.2, emoji: '🏃', name: 'Marathon', note: 'The classic 42.2 km' },
  { km: hv('mvd', 'pde'), emoji: '🏖️', name: 'Montevideo → Punta del Este', note: 'Uruguay 🇺🇾' },
  { km: hv('bog', 'med'), emoji: '☕', name: 'Bogotá → Medellín', note: 'Colombia 🇨🇴' },
  { km: hv('cdmx', 'aca'), emoji: '🌴', name: 'Mexico City → Acapulco', note: 'Mexico 🇲🇽' },
  { km: hv('rio', 'sp'), emoji: '🎶', name: 'Rio de Janeiro → São Paulo', note: 'Brazil 🇧🇷' },
  { km: 780, emoji: '🐚', name: 'Camino de Santiago', note: 'The French Way, Spain' },
  { km: hv('sp', 'mvd'), emoji: '🧉', name: 'São Paulo → Montevideo', note: 'Brazil 🇧🇷 to Uruguay 🇺🇾' },
  { km: hv('bog', 'cdmx'), emoji: '🌋', name: 'Bogotá → Mexico City', note: 'Legendary · Colombia 🇨🇴 to Mexico 🇲🇽' },
].sort((a, b) => a.km - b.km);

/* ── Challenge context ── */
export function context(ch, todayISO) {
  const dates = datesBetween(ch.start, ch.end);
  const N = dates.length;
  let status, todayIdx;
  if (todayISO < dates[0]) { status = 'upcoming'; todayIdx = -1; }
  else if (todayISO > dates[N - 1]) { status = 'finished'; todayIdx = N; }
  else { status = 'live'; todayIdx = dates.indexOf(todayISO); }
  const lastIdx = Math.min(todayIdx, N - 1);                                     // last day that can hold data
  const complete = status === 'live' ? todayIdx : status === 'finished' ? N : 0; // fully finished days
  return {
    ...ch, goal: ch.dailyGoal, dates, N, todayISO, todayIdx, lastIdx, complete, status,
    dayNumber: status === 'live' ? todayIdx + 1 : status === 'finished' ? N : 0,
    daysLeft: status === 'live' ? N - todayIdx - 1 : status === 'upcoming' ? N : 0,
    daysToStart: status === 'upcoming' ? Math.round((parseISO(dates[0]) - parseISO(todayISO)) / 864e5) : 0,
    weekKeys: dates.map(mondayOf),
    target: ch.dailyGoal * N,
  };
}

/* ── Per-member statistics ── */
export function memberStats(daily, ctx, profile) {
  const { goal, lastIdx, complete, todayIdx, status, N, dates, weekKeys } = ctx;
  let total = 0, logged = 0, goalDays = 0, best = 0, bestIdx = -1;
  for (let i = 0; i <= lastIdx; i++) {
    const v = daily[i];
    if (v == null) continue;
    total += v; logged++;
    if (v >= goal) goalDays++;
    if (v > best) { best = v; bestIdx = i; }
  }
  const today = status === 'live' ? daily[todayIdx] : null;

  // Averages use fully finished days so a half-synced "today" doesn't drag them down (day 1 falls back to today).
  let completeTotal = 0;
  for (let i = 0; i < complete; i++) completeTotal += daily[i] || 0;
  const avg = complete > 0 ? completeTotal / complete : today || 0;

  // Streaks (goal days) and logging runs
  let longest = 0, run = 0, logRun = 0, longestLogged = 0;
  for (let i = 0; i <= lastIdx; i++) {
    if ((daily[i] || 0) >= goal) { run++; longest = Math.max(longest, run); } else run = 0;
    if (daily[i] != null) { logRun++; longestLogged = Math.max(longestLogged, logRun); } else logRun = 0;
  }
  let current = 0;
  let i = lastIdx;
  if (status === 'live' && (daily[todayIdx] || 0) < goal) i = todayIdx - 1; // today still in progress
  while (i >= 0 && (daily[i] || 0) >= goal) { current++; i--; }

  // Weekday pattern
  const span = complete > 0 ? complete : today != null ? 1 : 0;
  const dowSum = Array(7).fill(0), dowCnt = Array(7).fill(0);
  let wkSum = 0, wkCnt = 0, weSum = 0, weCnt = 0;
  for (let k = 0; k < span; k++) {
    const v = daily[k] || 0, d = monIdx(dates[k]);
    dowSum[d] += v; dowCnt[d]++;
    if (d >= 5) { weSum += v; weCnt++; } else { wkSum += v; wkCnt++; }
  }

  // This week vs last week (Monday-based)
  const curWeek = lastIdx >= 0 ? weekKeys[lastIdx] : null;
  const prevWeek = curWeek ? addDays(curWeek, -7) : null;
  let thisWeek = 0, lastWeek = 0, lastWeekDays = 0, twDone = 0, twDoneDays = 0, weekActive = 0;
  for (let k = 0; k <= lastIdx; k++) {
    const v = daily[k] || 0;
    if (weekKeys[k] === curWeek) { thisWeek += v; weekActive += Math.max(0, v - 5000) / STEPS_PER_MIN; if (k < complete) { twDone += v; twDoneDays++; } }
    else if (weekKeys[k] === prevWeek) { lastWeek += v; lastWeekDays++; }
  }
  const improvement = twDoneDays && lastWeekDays && lastWeek > 0 ? twDone / twDoneDays / (lastWeek / lastWeekDays) - 1 : null;

  // Badge helpers
  let perfectWeek = false, bestWeekGoalDays = 0, weekendGoal = false, comeback = false;
  const weeks = {};
  for (let k = 0; k <= lastIdx; k++) {
    const w = (weeks[weekKeys[k]] ||= { days: 0, goal: 0 });
    w.days++;
    if ((daily[k] || 0) >= goal) w.goal++;
    if (k >= 1 && (daily[k - 1] || 0) < 5000 && (daily[k] || 0) >= goal) comeback = true;
    if (dow(dates[k]) === 0 && k >= 1 && (daily[k] || 0) >= goal && (daily[k - 1] || 0) >= goal) weekendGoal = true;
  }
  Object.values(weeks).forEach(w => {
    if (w.days === 7 && w.goal === 7) perfectWeek = true;
    bestWeekGoalDays = Math.max(bestWeekGoalDays, w.goal);
  });

  const remaining = N - complete;
  const countedDays = complete + (today != null ? 1 : 0);
  return {
    total, logged, goalDays, best, bestIdx, today, avg, longest, current, longestLogged,
    byDow: dowSum.map((s, k) => (dowCnt[k] ? s / dowCnt[k] : null)),
    weekdayAvg: wkCnt ? wkSum / wkCnt : null,
    weekendAvg: weCnt ? weSum / weCnt : null,
    weekendDays: weCnt,
    thisWeek, lastWeek, improvement,
    projected: Math.round(completeTotal + avg * remaining),
    need: remaining > 0 ? Math.max(0, (ctx.target - total) / remaining) : 0,
    remaining,
    consistency: countedDays ? logged / countedDays : null,
    km: toKm(total, profile), kcal: toKcal(total, profile), minutes: toMinutes(total),
    weekMinutes: toMinutes(thisWeek), weekActive,
    level: levelOf(avg),
    pctTarget: total / ctx.target,
    perfectWeek, bestWeekGoalDays, weekendGoal, comeback,
  };
}

/* ── Badges ── */
const MARATHON_STEPS = Math.round(42195 / DEFAULTS.strideM);
const CENTURY_STEPS = Math.round(100000 / DEFAULTS.strideM);
export const BADGES = [
  { id: 'first',    emoji: '👟', name: 'First Steps',     desc: 'Log your first day',                    test: s => s.logged / 1 },
  { id: '10k',      emoji: '🔟', name: '10K Club',        desc: 'Walk 10,000 steps in one day',          test: s => s.best / 10000 },
  { id: '15k',      emoji: '🚀', name: 'Rocket',          desc: 'Walk 15,000 steps in one day',          test: s => s.best / 15000 },
  { id: '20k',      emoji: '🦁', name: 'Beast Mode',      desc: 'Walk 20,000 steps in one day',          test: s => s.best / 20000 },
  { id: '30k',      emoji: '🏔️', name: 'Summit',          desc: 'Walk 30,000 steps in one day',          test: s => s.best / 30000 },
  { id: 'streak3',  emoji: '🔥', name: 'On Fire',         desc: 'Hit the goal 3 days in a row',          test: s => s.longest / 3 },
  { id: 'streak7',  emoji: '⚡', name: 'Unstoppable',     desc: 'Hit the goal 7 days in a row',          test: s => s.longest / 7 },
  { id: 'streak14', emoji: '👑', name: 'Legend',          desc: 'Hit the goal 14 days in a row',         test: s => s.longest / 14 },
  { id: 'week',     emoji: '🗓️', name: 'Perfect Week',    desc: 'Goal every day from Monday to Sunday',  test: s => (s.perfectWeek ? 1 : s.bestWeekGoalDays / 7) },
  { id: 'weekend',  emoji: '🏖️', name: 'Weekend Warrior', desc: 'Goal on Saturday and Sunday',           test: s => (s.weekendGoal ? 1 : 0) },
  { id: 'comeback', emoji: '💪', name: 'Comeback',        desc: 'Hit the goal right after a day under 5K', test: s => (s.comeback ? 1 : 0) },
  { id: 'loyal',    emoji: '📅', name: 'Never Miss',      desc: 'Log 7 days in a row',                   test: s => s.longestLogged / 7 },
  { id: 'marathon', emoji: '🏅', name: 'Marathoner',      desc: 'Walk 42.2 km in total',                 test: s => s.total / MARATHON_STEPS },
  { id: 'century',  emoji: '💯', name: 'Centurion',       desc: 'Walk 100 km in total',                  test: s => s.total / CENTURY_STEPS },
  { id: 'quarter',  emoji: '🎯', name: 'Quarter Million', desc: 'Reach 250,000 steps',                   test: s => s.total / 250000 },
  { id: 'champion', emoji: '🏆', name: 'Champion',        desc: '10K × every challenge day',             test: (s, m, ctx) => s.total / ctx.target },
  { id: 'auto',     emoji: '🤖', name: 'Autopilot',       desc: 'Sync steps automatically',              test: (s, m) => (m.autoSyncs > 0 ? 1 : 0) },
];
export function badgesOf(m, ctx) {
  return BADGES.map(b => {
    const p = Math.max(0, Math.min(1, b.test(m.s, m, ctx) || 0));
    return { id: b.id, emoji: b.emoji, name: b.name, desc: b.desc, earned: p >= 1, progress: p };
  });
}

/* ── Team statistics ── */
export function teamStats(members, ctx) {
  const { N, lastIdx, complete, goal, todayIdx, status } = ctx;
  const M = members.length;
  const dailyTotals = [], loggedCount = [], avgLogged = [], cumulative = [];
  let run = 0;
  for (let i = 0; i < N; i++) {
    if (i > lastIdx) { dailyTotals.push(null); loggedCount.push(0); avgLogged.push(null); cumulative.push(null); continue; }
    let t = 0, c = 0;
    members.forEach(m => { if (m.daily[i] != null) { t += m.daily[i]; c++; } });
    dailyTotals.push(t); loggedCount.push(c); avgLogged.push(c ? t / c : null);
    run += t; cumulative.push(run);
  }
  const total = run;
  const teamGoal = goal * M * N;
  let completeTotal = 0;
  for (let i = 0; i < complete; i++) completeTotal += dailyTotals[i];
  const today = status === 'live' ? dailyTotals[todayIdx] : null;
  const avgDay = complete > 0 ? completeTotal / complete : today || 0;
  const projected = completeTotal + avgDay * (N - complete);
  let best = 0, bestIdx = -1;
  dailyTotals.forEach((v, i) => { if (v != null && v > best) { best = v; bestIdx = i; } });
  return {
    M, total, teamGoal, progress: total / teamGoal,
    dailyTotals, loggedCount, avgLogged, cumulative,
    pace: Array.from({ length: N }, (_, i) => goal * M * (i + 1)),
    dailyGoal: goal * M,
    today,
    loggedToday: status === 'live' ? loggedCount[todayIdx] : 0,
    goalToday: status === 'live' ? members.filter(m => (m.daily[todayIdx] || 0) >= goal).length : 0,
    avgDay, avgPerMember: M ? avgDay / M : 0,
    projected, projectedPct: projected / teamGoal,
    memberDayGoals: members.reduce((a, m) => a + m.s.goalDays, 0),
    best, bestIdx,
    km: toKm(total), kcal: toKcal(total), minutes: toMinutes(total),
    joined: members.filter(m => m.joined).length,
    autoCount: members.filter(m => m.autoSyncs > 0).length,
  };
}

/* ── Hall of fame (only categories that have a real winner) ── */
export function hallOfFame(members, ctx) {
  const top = (key, min = 1) => {
    const list = members.filter(m => m.s[key] != null && m.s[key] >= min).sort((a, b) => b.s[key] - a.s[key]);
    return list.length ? list[0] : null;
  };
  const out = [];
  if (ctx.status === 'live') {
    const tl = top('today', 1);
    if (tl) out.push({ id: 'today', emoji: '⚡', title: "Today's leader", m: tl, value: tl.s.today, unit: 'steps so far' });
  }
  const bd = top('best', 1);
  if (bd) out.push({ id: 'bestday', emoji: '🏆', title: 'Best single day', m: bd, value: bd.s.best, unit: 'steps', note: ctx.dates[bd.s.bestIdx] });
  const ls = top('longest', 2);
  if (ls) out.push({ id: 'streak', emoji: '🔥', title: 'Longest streak', m: ls, value: ls.s.longest, unit: 'days in a row' });
  const gd = top('goalDays', 1);
  if (gd) out.push({ id: 'goaldays', emoji: '🎯', title: 'Most 10K days', m: gd, value: gd.s.goalDays, unit: 'goal days' });
  const ww = members.filter(m => m.s.weekendDays > 0 && m.s.weekendAvg > 0).sort((a, b) => b.s.weekendAvg - a.s.weekendAvg)[0];
  if (ww) out.push({ id: 'weekend', emoji: '🏖️', title: 'Weekend warrior', m: ww, value: Math.round(ww.s.weekendAvg), unit: 'avg on weekends' });
  const mi = members.filter(m => m.s.improvement != null && m.s.improvement > 0.02).sort((a, b) => b.s.improvement - a.s.improvement)[0];
  if (mi) out.push({ id: 'improved', emoji: '📈', title: 'Most improved', m: mi, value: Math.round(mi.s.improvement * 100), unit: '% vs last week', pct: true });
  return out;
}

/* ── Model: everything the views need ── */
export function normalizeDaily(daily, N) {
  const out = [];
  for (let i = 0; i < N; i++) {
    const v = daily && daily[i];
    out.push(v === null || v === undefined || v === '' || !isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v))));
  }
  return out;
}

export function buildModel(data, todayISO, profile, meId) {
  const ctx = context(data.challenge, todayISO);
  const members = data.members.map((m, k) => {
    const daily = normalizeDaily(m.daily, ctx.N);
    const name = String(m.name || m.id).trim();
    return { ...m, name, idx: k, first: name.split(/\s+/)[0], daily, s: memberStats(daily, ctx, null) };
  });
  const ranked = members.slice().sort((a, b) => b.s.total - a.s.total || a.name.localeCompare(b.name));
  ranked.forEach((m, k) => { m.rank = k + 1; });
  members.forEach(m => { m.badges = badgesOf(m, ctx); m.badgeCount = m.badges.filter(b => b.earned).length; });
  const team = teamStats(members, ctx);
  const me = members.find(m => m.id === meId) || null;
  if (me) me.ps = memberStats(me.daily, ctx, profile); // personalised with height/weight
  return { ctx, members, byId: Object.fromEntries(members.map(m => [m.id, m])), team, me, ranked };
}
