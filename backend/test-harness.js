// Offline test-suite for backend/Code.gs — mocks the Google Apps Script services.
// Run: node backend/test-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

/* ── Minimal Apps Script mocks ── */
const chain = (target = {}) => new Proxy(target, {
  get: (t, k) => (k in t ? t[k] : () => chain(t)),
});

class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.data.length - 1; r >= 0; r--) if ((this.data[r] || []).some(v => v !== '' && v != null)) return r + 1;
    return 0;
  }
  lastCol() { return Math.max(0, ...this.data.map(r => (r || []).length)); }
  cell(r, c) { return ((this.data[r - 1] || [])[c - 1]) ?? ''; }
  put(r, c, v) { while (this.data.length < r) this.data.push([]); const row = this.data[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.lastCol())); }
  appendRow(arr) { const r = this.getLastRow() + 1; arr.forEach((v, i) => this.put(r, i + 1, v)); }
  clear() { this.data = []; return this; }
}
for (const m of ['clearConditionalFormatRules', 'setConditionalFormatRules', 'setFrozenRows', 'setFrozenColumns', 'setColumnWidth']) Sheet.prototype[m] = function () { return this; };

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); return chain(this); }
  getValues() { return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => this.sh.cell(this.r + i, this.c + j))); }
  setValues(v) { assert.strictEqual(v.length, this.nr, 'setValues row mismatch'); v.forEach((row, i) => { assert.strictEqual(row.length, this.nc, 'setValues col mismatch'); row.forEach((x, j) => this.sh.put(this.r + i, this.c + j, x)); }); return this; }
  setValue(v) { this.sh.put(this.r, this.c, v); return this; }
  getValue() { return this.sh.cell(this.r, this.c); }
}

function makeSpreadsheet() {
  const sheets = [new Sheet('Sheet1')];
  return {
    sheets,
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    insertSheet: (n, idx) => { const s = new Sheet(n); idx === 0 ? sheets.unshift(s) : sheets.push(s); return s; },
    getSheets: () => sheets.slice(),
    deleteSheet: s => sheets.splice(sheets.indexOf(s), 1),
    setActiveSheet: s => s,
  };
}

function makeContext() {
  const ss = makeSpreadsheet();
  const cache = new Map();
  const props = new Map();
  const ctx = {
    console,
    SpreadsheetApp: { getActive: () => ss, newConditionalFormatRule: () => chain({}) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(s, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      base64Encode: bytes => Buffer.from(bytes.map(b => (b < 0 ? b + 256 : b))).toString('base64'),
      formatDate: (d, tz, f) => {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map(p => [p.type, p.value]));
        return f === 'yyyy' ? parts.year : `${parts.year}-${parts.month}-${parts.day}`;
      },
    },
    CacheService: { getScriptCache: () => ({ get: k => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json', TEXT: 'text' },
      createTextOutput: s => ({ content: s, mime: null, setMimeType(m) { this.mime = m; return this; } }),
    },
    Logger: { log: () => {} },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  return { ctx, ss, cache };
}

/* ── Tests ── */
const { ctx, ss, cache } = makeContext();
const run = code => vm.runInContext(code, ctx);
const get = params => { const out = run(`doGet(${JSON.stringify({ parameter: params })})`); return out.mime === 'json' ? JSON.parse(out.content) : out.content; };
const post = body => JSON.parse(run(`doPost(${JSON.stringify({ parameter: {}, postData: { contents: JSON.stringify(body) } })})`).content);
const todayIn = tz => ctx.Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };

console.log('Backend tests');

test('setup builds the Steps, Members and Log sheets', () => {
  run('setup()');
  const steps = ss.getSheetByName('Steps');
  assert.ok(steps && ss.getSheetByName('Members') && ss.getSheetByName('Log'));
  assert.strictEqual(ss.getSheetByName('Sheet1'), null, 'blank sheet removed');
  assert.strictEqual(Object.prototype.toString.call(steps.cell(2, 4)), '[object Date]');
  assert.strictEqual(steps.cell(3, 1), 'rogelio');
  assert.strictEqual(steps.cell(11, 1), 'minerva');
  assert.strictEqual(steps.cell(12, 2), 'Team total');
  assert.strictEqual(steps.cell(12, 3), '=SUM(C3:C11)', 'team total includes Minerva (row 11)');
  assert.strictEqual(steps.cell(3, 3), '=SUM(D3:AD3)', '27 day columns D..AD');
});

test('data returns 9 members with 27 empty days', () => {
  const d = get({ action: 'data' });
  assert.strictEqual(d.ok, true);
  assert.strictEqual(d.members.length, 9);
  assert.strictEqual(d.members[0].daily.length, 27);
  assert.ok(d.members.every(m => m.daily.every(v => v === null) && m.joined === false));
  assert.strictEqual(d.members.find(m => m.id === 'luis').name, 'Luís Rodney');
});

let token;
test('claim creates a PIN and returns a sync key', () => {
  const r = post({ action: 'claim', m: 'eron', pin: '1234', tz: 'America/Sao_Paulo' });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.created, true); assert.match(r.token, /^[a-f0-9]{32}$/);
  token = r.token;
  const again = post({ action: 'claim', m: 'eron', pin: '1234' });
  assert.strictEqual(again.token, token); assert.strictEqual(again.created, false);
});

test('claim rejects a wrong or malformed PIN', () => {
  assert.match(post({ action: 'claim', m: 'eron', pin: '9999' }).error, /Wrong PIN/);
  assert.match(post({ action: 'claim', m: 'eron', pin: '12' }).error, /4 digits/);
  assert.match(post({ action: 'claim', m: 'nobody', pin: '1234' }).error, /Unknown member/);
});

test('data marks claimed members without leaking secrets', () => {
  const d = get({ action: 'data' });
  const eron = d.members.find(m => m.id === 'eron');
  assert.strictEqual(eron.joined, true);
  assert.ok(!JSON.stringify(d).includes(token), 'token never exposed');
  assert.ok(!JSON.stringify(d).includes('pinHash'));
});

test('log from the app saves (set mode) and parses formatted numbers', () => {
  const r = post({ action: 'log', m: 'eron', t: token, date: '2026-10-20', steps: '8,432' });
  assert.strictEqual(r.ok, true, r.error); assert.strictEqual(r.steps, 8432); assert.strictEqual(r.previous, null);
  const lower = post({ action: 'log', m: 'eron', t: token, date: '2026-10-20', steps: 5000 });
  assert.strictEqual(lower.steps, 5000, 'manual edits can lower a value');
  assert.strictEqual(get({ action: 'data' }).members.find(m => m.id === 'eron').daily[0], 5000);
});

test('sync (Shortcut) keeps the max and replies in plain text', () => {
  const txt = get({ action: 'sync', m: 'eron', t: token, date: '2026-10-20', steps: '12345.0' });
  assert.match(txt, /^✅ 12,345 steps saved for Tue, Oct 20/);
  const lower = get({ action: 'sync', m: 'eron', t: token, date: '2026-10-20', steps: '3000', format: 'json' });
  assert.strictEqual(lower.steps, 12345, 'automatic sync never lowers a value');
  const d = get({ action: 'data' }).members.find(m => m.id === 'eron');
  assert.strictEqual(d.lastSource, 'shortcut'); assert.strictEqual(d.autoSyncs, 2);
});

test('sync without a date uses the member\'s local "today"', () => {
  const t = todayIn('America/Sao_Paulo');
  const r = get({ action: 'sync', m: 'eron', t: token, steps: '777', format: 'json' });
  if (t >= '2026-10-20' && t <= '2026-11-15') { assert.strictEqual(r.ok, true, r.error); assert.strictEqual(r.date, t); }
  else assert.strictEqual(r.ok, false);
});

test('validation: bad key, future day, out of range, too many steps', () => {
  assert.match(post({ action: 'log', m: 'eron', t: 'nope', date: '2026-10-20', steps: 1 }).error, /Invalid sync key/);
  assert.match(post({ action: 'log', m: 'eron', t: token, date: '2026-10-19', steps: 1 }).error, /starts on/);
  assert.match(post({ action: 'log', m: 'eron', t: token, date: '2026-11-16', steps: 1 }).error, /ended on|future/);
  assert.match(post({ action: 'log', m: 'eron', t: token, date: '2026-10-20', steps: 250000 }).error, /too high/);
  assert.match(post({ action: 'log', m: 'eron', t: token, date: '2026-10-20', steps: -5 }).error, /positive|Missing/);
  assert.match(get({ action: 'sync', m: 'eron', t: 'bad', steps: 10 }), /^⚠️ Invalid sync key/);
});

test('re-running setup preserves steps, PINs and keys', () => {
  run('setup()');
  const d = get({ action: 'data' });
  assert.strictEqual(d.members.find(m => m.id === 'eron').daily[0], 12345);
  assert.strictEqual(post({ action: 'claim', m: 'eron', pin: '1234' }).token, token);
});

test('organizer edits in the sheet show up (cache invalidation aside)', () => {
  ss.getSheetByName('Steps').put(11, 5, 15000); // Minerva, Oct 21
  cache.delete('data');
  assert.strictEqual(get({ action: 'data' }).members.find(m => m.id === 'minerva').daily[1], 15000);
});

test('PIN lockout after repeated failures', () => {
  post({ action: 'claim', m: 'gonza', pin: '1111' });
  for (let i = 0; i < 8; i++) post({ action: 'claim', m: 'gonza', pin: '0000' });
  assert.match(post({ action: 'claim', m: 'gonza', pin: '1111' }).error, /Too many/);
});

test('audit log records changes only', () => {
  const log = ss.getSheetByName('Log');
  assert.ok(log.getLastRow() >= 4);
  assert.deepStrictEqual(log.getRange(1, 1, 1, 6).getValues()[0], ['timestamp', 'id', 'date', 'steps', 'previous', 'source']);
});

test('profile saves an avatar everyone can see', () => {
  const r = post({ action: 'profile', m: 'eron', t: token, avatar: 'm2' });
  assert.strictEqual(r.ok, true, r.error);
  const d = get({ action: 'data' });
  assert.strictEqual(d.members.find(m => m.id === 'eron').avatar, 'm2');
  assert.strictEqual(d.members.find(m => m.id === 'luis').avatar, '');
  assert.strictEqual(post({ action: 'profile', m: 'eron', t: token, avatar: '' }).avatar, '', 'empty = back to initials');
  assert.strictEqual(get({ action: 'data' }).members.find(m => m.id === 'eron').avatar, '');
});

test('profile validates the key and the avatar id', () => {
  assert.strictEqual(post({ action: 'profile', m: 'eron', t: 'nope', avatar: 'f1' }).code, 'invalidKey');
  assert.strictEqual(post({ action: 'profile', m: 'eron', t: token, avatar: '<script>' }).code, 'badAvatar');
  assert.strictEqual(post({ action: 'profile', m: 'luis', t: '', avatar: 'f1' }).code, 'missingKey');
});

test('profile works on a Members sheet created before v1.1 (no avatar column)', () => {
  const sh = ss.getSheetByName('Members');
  for (let r = 1; r <= sh.getLastRow(); r++) sh.put(r, 11, '');
  assert.strictEqual(post({ action: 'profile', m: 'eron', t: token, avatar: 'f3' }).ok, true);
  assert.strictEqual(sh.cell(1, 11), 'avatar', 'header added');
  assert.strictEqual(get({ action: 'data' }).members.find(m => m.id === 'eron').avatar, 'f3');
  run('setup()');
  assert.strictEqual(get({ action: 'data' }).members.find(m => m.id === 'eron').avatar, 'f3', 'setup keeps avatars');
});

test('messages follow lang=pt|es (errors and the Shortcut reply)', () => {
  assert.match(get({ action: 'sync', m: 'eron', t: token, date: '2026-10-21', steps: '12345', lang: 'pt' }), /^✅ 12\.345 passos salvos \(qua, 21\/10\)\. Continue assim, Team 8!$/);
  assert.match(get({ action: 'sync', m: 'eron', t: token, date: '2026-10-21', steps: '12345', lang: 'es' }), /^✅ 12,345 pasos guardados \(mié, 21\/10\)\. ¡Sigue así, Team 8!$/);
  assert.match(get({ action: 'sync', m: 'eron', t: 'bad', steps: 10, lang: 'pt' }), /^⚠️ Chave de sincronização inválida/);
  const e = post({ action: 'log', m: 'eron', t: token, date: '2026-10-19', steps: 1, lang: 'es' });
  assert.strictEqual(e.code, 'startsOn');
  assert.strictEqual(e.error, 'El reto empieza el mar, 20/10.');
  assert.strictEqual(post({ action: 'claim', m: 'eron', pin: '9', lang: 'pt' }).error, 'O PIN precisa ter 4 dígitos.');
  assert.match(post({ action: 'log', m: 'eron', t: token, date: '2026-10-20', steps: 250000, lang: 'pt' }).error, /máx\. 100\.000 passos/);
  assert.strictEqual(post({ action: 'claim', m: 'eron', pin: '1234', lang: 'xx' }).ok, true, 'unknown lang falls back to English');
});

console.log(`\n${passed} tests passed`);
