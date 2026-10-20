/**
 * Team 8 · Step Challenge — backend (Google Apps Script + Google Sheets)
 *
 * The Google Sheet is the database and the admin panel:
 *   • "Steps"   – one row per member, one column per challenge day (same layout as the old Excel file)
 *   • "Members" – roster, PIN hashes, sync keys, time zone and last sync info (keep this sheet private)
 *   • "Log"     – audit trail of every change
 *
 * Endpoints (deploy as Web App → Execute as: Me · Who has access: Anyone):
 *   GET  ?action=data                                   → public dashboard data (names + steps only)
 *   POST {action:'claim', m, pin, tz}                   → create / verify a member PIN, returns the sync key
 *   POST {action:'log',   m, t, date, steps, mode}      → save steps from the app (mode "set" by default)
 *   GET  ?action=sync&m=<id>&t=<key>&steps=<n>[&date=]  → automatic sync (iPhone Shortcut, Tasker…), mode "max"
 *
 * See docs/SETUP.md for the 5-minute deployment guide.
 */

const APP = {
  version: '1.0.0',
  team: 'Team 8',
  name: 'Step Challenge',
  start: '2026-10-20',
  end: '2026-11-15',
  dailyGoal: 10000,
  maxSteps: 100000,       // anything above this is rejected as a typo
  graceDays: 7,           // late edits allowed for a week after the end
  pinAttempts: 8,         // wrong PINs before a 15-minute lockout
  cacheSeconds: 20,
};

const ROSTER = [
  { id: 'rogelio',  name: 'Rogelio Garcia',         country: 'MX' },
  { id: 'gonza',    name: 'Gonza Souza',            country: 'UY' },
  { id: 'sidnei',   name: 'Sidnei Marcos Guerbali', country: 'BR' },
  { id: 'eron',     name: 'Eron Netto',             country: 'BR' },
  { id: 'danielle', name: 'Danielle Surini',        country: 'BR' },
  { id: 'luis',     name: 'Luís Rodney',            country: 'BR' },
  { id: 'helbert',  name: 'Helbert Contreras',      country: 'CO' },
  { id: 'armando',  name: 'Armando Alarcon',        country: 'MX' },
  { id: 'minerva',  name: 'Minerva Perez',          country: 'MX' },
];

const TZ_BY_COUNTRY = {
  BR: 'America/Sao_Paulo', MX: 'America/Mexico_City', UY: 'America/Montevideo', CO: 'America/Bogota',
};
const DEFAULT_TZ = 'America/Sao_Paulo';

const SHEET = { steps: 'Steps', members: 'Members', log: 'Log' };
const MEMBER_COLS = ['id', 'name', 'country', 'timezone', 'pinHash', 'token', 'joinedAt', 'lastSyncAt', 'lastSource', 'autoSyncs'];
const FIRST_DAY_COL = 4;   // column D
const FIRST_MEMBER_ROW = 3;

/* ───────────────────────────── HTTP entry points ───────────────────────────── */

function doGet(e) {
  return handle_((e && e.parameter) || {});
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
  return handle_(Object.assign({}, (e && e.parameter) || {}, body));
}

function handle_(p) {
  const action = String(p.action || '').toLowerCase();
  const wantsText = action === 'sync' && String(p.format || '').toLowerCase() !== 'json';
  try {
    let out;
    switch (action) {
      case 'data':  out = getData_(); break;
      case 'claim': out = claim_(p); break;
      case 'log':   out = log_(p, 'app'); break;
      case 'sync':  out = log_(p, String(p.source || 'shortcut').slice(0, 20)); break;
      default:      out = { ok: true, app: APP.team + ' ' + APP.name + ' API', version: APP.version };
    }
    if (wantsText) {
      return text_('✅ ' + fmt_(out.steps) + ' steps saved for ' + prettyDate_(out.date) + '. Keep moving, ' + APP.team + '!');
    }
    return json_(out);
  } catch (err) {
    const message = String((err && err.message) || err);
    return wantsText ? text_('⚠️ ' + message) : json_({ ok: false, error: message });
  }
}

/* ───────────────────────────── Actions ───────────────────────────── */

function getData_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('data');
  if (hit) return JSON.parse(hit);

  const ss = SpreadsheetApp.getActive();
  const dates = challengeDates_();
  const mem = readMembers_(sheet_(ss, SHEET.members));
  const st = readSteps_(sheet_(ss, SHEET.steps), dates.length);

  const members = st.order.map(function (id) {
    const m = mem.byId[id] || {};
    return {
      id: id,
      name: String(m.name || st.names[id] || id),
      country: String(m.country || ''),
      joined: !!m.pinHash,
      lastSyncAt: toIso_(m.lastSyncAt),
      lastSource: String(m.lastSource || ''),
      autoSyncs: Number(m.autoSyncs) || 0,
      daily: st.byId[id],
    };
  });

  const out = {
    ok: true,
    version: APP.version,
    challenge: { team: APP.team, name: APP.name, start: APP.start, end: APP.end, dailyGoal: APP.dailyGoal },
    updatedAt: new Date().toISOString(),
    members: members,
  };
  cache.put('data', JSON.stringify(out), APP.cacheSeconds);
  return out;
}

function claim_(p) {
  const id = normId_(p.m || p.member);
  const pin = String(p.pin || '').trim();
  if (!/^\d{4}$/.test(pin)) throw new Error('Your PIN must have 4 digits.');

  const cache = CacheService.getScriptCache();
  const failKey = 'fail:' + id;
  const fails = Number(cache.get(failKey)) || 0;
  if (fails >= APP.pinAttempts) throw new Error('Too many wrong PINs. Try again in 15 minutes.');

  return withLock_(function () {
    const ss = SpreadsheetApp.getActive();
    const sh = sheet_(ss, SHEET.members);
    const mem = readMembers_(sh);
    const m = mem.byId[id];
    if (!m) throw new Error('Unknown member.');
    const row = mem.rowById[id];
    const hash = hashPin_(id, pin);
    let created = false;

    if (!m.pinHash) {
      created = true;
      setCell_(sh, row, 'pinHash', hash);
      setCell_(sh, row, 'joinedAt', new Date());
    } else if (m.pinHash !== hash) {
      cache.put(failKey, String(fails + 1), 15 * 60);
      const left = APP.pinAttempts - fails - 1;
      throw new Error('Wrong PIN.' + (left > 0 ? ' ' + left + ' attempts left.' : ''));
    }

    let token = String(m.token || '');
    if (!token) {
      token = Utilities.getUuid().replace(/-/g, '');
      setCell_(sh, row, 'token', token);
    }
    const tz = validTz_(p.tz);
    if (tz && tz !== m.timezone) setCell_(sh, row, 'timezone', tz);

    cache.remove(failKey);
    cache.remove('data');
    return { ok: true, id: id, name: m.name, token: token, created: created };
  });
}

function log_(p, source) {
  const id = normId_(p.m || p.member);
  const token = String(p.t || p.token || '').trim();
  if (!id || !token) throw new Error('Missing member or sync key.');
  const steps = parseSteps_(p.steps);
  const mode = p.mode === 'set' || p.mode === 'max' ? p.mode : (source === 'app' ? 'set' : 'max');
  const dates = challengeDates_();

  return withLock_(function () {
    const ss = SpreadsheetApp.getActive();
    const memSh = sheet_(ss, SHEET.members);
    const mem = readMembers_(memSh);
    const m = mem.byId[id];
    if (!m) throw new Error('Unknown member.');
    if (!m.token || m.token !== token) throw new Error('Invalid sync key. Open the app and sign in again.');

    const tz = validTz_(m.timezone) || TZ_BY_COUNTRY[m.country] || DEFAULT_TZ;
    const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const date = p.date ? normDate_(p.date) : today;

    if (date < APP.start) throw new Error('The challenge starts on ' + prettyDate_(APP.start) + '.');
    if (date > APP.end) throw new Error('The challenge ended on ' + prettyDate_(APP.end) + '.');
    if (date > addDays_(today, 1)) throw new Error("You can't log steps for future days.");
    if (today > addDays_(APP.end, APP.graceDays)) throw new Error('The challenge is closed.');

    const stSh = sheet_(ss, SHEET.steps);
    const st = readSteps_(stSh, dates.length);
    const row = st.rowById[id];
    if (!row) throw new Error('Member not found in the Steps sheet.');
    const i = dates.indexOf(date);
    const previous = st.byId[id][i];
    const next = mode === 'max' ? Math.max(previous || 0, steps) : steps;
    const changed = previous !== next;

    if (changed) {
      stSh.getRange(row, FIRST_DAY_COL + i).setValue(next);
      sheet_(ss, SHEET.log).appendRow([new Date(), id, date, next, previous === null ? '' : previous, source]);
    }
    const mrow = mem.rowById[id];
    setCell_(memSh, mrow, 'lastSyncAt', new Date());
    setCell_(memSh, mrow, 'lastSource', source);
    if (source !== 'app') setCell_(memSh, mrow, 'autoSyncs', (Number(m.autoSyncs) || 0) + 1);

    CacheService.getScriptCache().remove('data');
    return { ok: true, id: id, date: date, steps: next, previous: previous, changed: changed, source: source };
  });
}

/* ───────────────────────────── One-time setup ───────────────────────────── */

/**
 * Run this once from the Apps Script editor (select "setup" → Run).
 * Safe to re-run: existing steps, PINs and sync keys are preserved.
 */
function setup() {
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SALT')) props.setProperty('SALT', Utilities.getUuid());

  const dates = challengeDates_();
  const ids = setupMembers_(ss);
  setupSteps_(ss, dates, ids);
  setupLog_(ss);

  const blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('Página1') || ss.getSheetByName('Hoja 1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  ss.setActiveSheet(ss.getSheetByName(SHEET.steps));

  CacheService.getScriptCache().remove('data');
  Logger.log('✅ Setup complete: ' + ids.length + ' members, ' + dates.length + ' days.');
}

function setupMembers_(ss) {
  const sh = ss.getSheetByName(SHEET.members) || ss.insertSheet(SHEET.members);
  const existing = sh.getLastRow() > 1 ? readMembers_(sh).byId : {};
  const ids = ROSTER.map(function (r) { return r.id; });
  Object.keys(existing).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });

  const rows = ids.map(function (id) {
    const r = ROSTER.filter(function (x) { return x.id === id; })[0] || {};
    const e = existing[id] || {};
    const country = e.country || r.country || '';
    return [
      id, e.name || r.name || id, country, e.timezone || TZ_BY_COUNTRY[country] || DEFAULT_TZ,
      e.pinHash || '', e.token || '', e.joinedAt || '', e.lastSyncAt || '', e.lastSource || '', Number(e.autoSyncs) || 0,
    ];
  });

  sh.clear();
  sh.getRange(1, 1, 1, MEMBER_COLS.length).setValues([MEMBER_COLS]).setFontWeight('bold').setBackground('#e8eefc');
  if (rows.length) sh.getRange(2, 1, rows.length, MEMBER_COLS.length).setValues(rows);
  sh.setFrozenRows(1);
  sh.getRange(2, 7, Math.max(rows.length, 1), 2).setNumberFormat('yyyy-mm-dd hh:mm');
  sh.setColumnWidth(2, 190);
  sh.setColumnWidth(5, 120);
  sh.setColumnWidth(6, 120);
  sh.getRange(1, 12).setValue('ℹ️ To reset someone\'s PIN, clear their pinHash and token cells. Keep this sheet private.');
  return ids;
}

function setupSteps_(ss, dates, ids) {
  const N = dates.length;
  const sh = ss.getSheetByName(SHEET.steps) || ss.insertSheet(SHEET.steps, 0);
  const prev = sh.getLastRow() >= FIRST_MEMBER_ROW ? readSteps_(sh, N).byId : {};
  const names = readMembers_(ss.getSheetByName(SHEET.members)).byId;
  const lastCol = FIRST_DAY_COL + N - 1;
  const L = colLetter_(lastCol);

  sh.clear();
  sh.clearConditionalFormatRules();

  const title = ['👟 ' + APP.team + ' · ' + APP.name, '', ''].concat(dates.map(function (d) {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parseDate_(d).getDay()];
  }));
  const header = ['ID', 'Name', 'TOTAL'].concat(dates.map(parseDate_));
  const body = ids.map(function (id, k) {
    const r = FIRST_MEMBER_ROW + k;
    const vals = (prev[id] || []).slice(0, N);
    while (vals.length < N) vals.push(null);
    return [id, (names[id] && names[id].name) || id, '=SUM(D' + r + ':' + L + r + ')'].concat(vals.map(function (v) { return v === null ? '' : v; }));
  });
  const lastRow = FIRST_MEMBER_ROW + ids.length - 1;
  const totalRow = ['', 'Team total', '=SUM(C' + FIRST_MEMBER_ROW + ':C' + lastRow + ')'];
  for (let c = FIRST_DAY_COL; c <= lastCol; c++) {
    const cl = colLetter_(c);
    totalRow.push('=SUM(' + cl + FIRST_MEMBER_ROW + ':' + cl + lastRow + ')');
  }

  sh.getRange(1, 1, 1, title.length).setValues([title]);
  sh.getRange(2, 1, 1, header.length).setValues([header]);
  if (body.length) sh.getRange(FIRST_MEMBER_ROW, 1, body.length, header.length).setValues(body);
  sh.getRange(lastRow + 1, 1, 1, totalRow.length).setValues([totalRow]);

  // Formatting for humans (the API never depends on it)
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(12);
  sh.getRange(1, FIRST_DAY_COL, 1, N).setFontColor('#6b7280').setHorizontalAlignment('center');
  sh.getRange(2, 1, 1, header.length).setFontWeight('bold').setBackground('#1650d0').setFontColor('#ffffff');
  sh.getRange(2, FIRST_DAY_COL, 1, N).setNumberFormat('mmm d').setHorizontalAlignment('center');
  sh.getRange(FIRST_MEMBER_ROW, 3, ids.length + 1, N + 1).setNumberFormat('#,##0');
  sh.getRange(lastRow + 1, 1, 1, header.length).setFontWeight('bold').setBackground('#eef2ff');
  sh.getRange(FIRST_MEMBER_ROW, 3, ids.length, 1).setFontWeight('bold');
  sh.setFrozenRows(2);
  sh.setFrozenColumns(3);
  sh.setColumnWidth(1, 80);
  sh.setColumnWidth(2, 190);
  sh.setColumnWidth(3, 90);
  for (let c = FIRST_DAY_COL; c <= lastCol; c++) sh.setColumnWidth(c, 62);

  const grid = sh.getRange(FIRST_MEMBER_ROW, FIRST_DAY_COL, ids.length, N);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(APP.dailyGoal)
      .setBackground('#c6f6d5').setFontColor('#065f46').setRanges([grid]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(1, APP.dailyGoal - 1)
      .setBackground('#fef9c3').setRanges([grid]).build(),
  ]);
}

function setupLog_(ss) {
  const sh = ss.getSheetByName(SHEET.log) || ss.insertSheet(SHEET.log);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 6).setValues([['timestamp', 'id', 'date', 'steps', 'previous', 'source']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
}

/* ───────────────────────────── Sheet helpers ───────────────────────────── */

function readMembers_(sh) {
  const out = { byId: {}, rowById: {} };
  if (!sh || sh.getLastRow() < 2) return out;
  const values = sh.getDataRange().getValues();
  const head = values[0].map(function (h) { return String(h).trim(); });
  for (let r = 1; r < values.length; r++) {
    const obj = {};
    MEMBER_COLS.forEach(function (c) {
      const k = head.indexOf(c);
      obj[c] = k >= 0 ? values[r][k] : '';
    });
    const id = normId_(obj.id);
    if (!id) continue;
    obj.id = id;
    out.byId[id] = obj;
    out.rowById[id] = r + 1;
  }
  return out;
}

function readSteps_(sh, N) {
  const out = { order: [], byId: {}, rowById: {}, names: {} };
  if (!sh || sh.getLastRow() < FIRST_MEMBER_ROW) return out;
  const values = sh.getDataRange().getValues();
  for (let r = FIRST_MEMBER_ROW - 1; r < values.length; r++) {
    const id = normId_(values[r][0]);
    if (!id) continue;
    const daily = [];
    for (let i = 0; i < N; i++) daily.push(cellSteps_(values[r][FIRST_DAY_COL - 1 + i]));
    out.order.push(id);
    out.byId[id] = daily;
    out.rowById[id] = r + 1;
    out.names[id] = values[r][1];
  }
  return out;
}

function setCell_(sh, row, col, value) {
  sh.getRange(row, MEMBER_COLS.indexOf(col) + 1).setValue(value);
}

function sheet_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" is missing. Run setup() in the Apps Script editor.');
  return sh;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ───────────────────────────── Value helpers ───────────────────────────── */

function cellSteps_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) ? Math.max(0, Math.round(v)) : null;
  const digits = String(v).replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

function parseSteps_(raw) {
  let s = String(raw === null || raw === undefined ? '' : raw).replace(/[\s  ']/g, '');
  if (!s) throw new Error('Missing step count.');
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');   // 12,345 or 12.345
  else s = s.replace(',', '.');                                       // 12345,0 → 12345.0
  const n = Math.round(Number(s));
  if (!isFinite(n) || n < 0) throw new Error('Steps must be a positive number.');
  if (n > APP.maxSteps) throw new Error('That looks too high (max ' + fmt_(APP.maxSteps) + ' steps per day).');
  return n;
}

function hashPin_(id, pin) {
  const salt = PropertiesService.getScriptProperties().getProperty('SALT') || '';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + id + ':' + pin, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function normId_(v) {
  return String(v === null || v === undefined ? '' : v).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function normDate_(v) {
  const m = String(v).trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) throw new Error('Dates must look like 2026-10-20.');
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

function validTz_(tz) {
  if (!tz) return '';
  try { Utilities.formatDate(new Date(), String(tz), 'yyyy'); return String(tz); } catch (e) { return ''; }
}

function challengeDates_() {
  const out = [];
  for (let d = APP.start; d <= APP.end; d = addDays_(d, 1)) out.push(d);
  return out;
}

function parseDate_(iso) {
  const p = iso.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 12);
}

function addDays_(iso, n) {
  const p = iso.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.toISOString().slice(0, 10);
}

function prettyDate_(iso) {
  const d = parseDate_(iso);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ', ' + mon + ' ' + d.getDate();
}

function toIso_(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function fmt_(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function colLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function text_(s) {
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT);
}
