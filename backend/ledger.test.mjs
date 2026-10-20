// Ledger rules (js/ledger.js) — run with: node --test backend/ledger.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/ledger.js';

const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const at = (day, hourUtc = 15) => Date.UTC(2026, 9, day, hourUtc) / 1000; // October 2026, unix seconds
let seq = 0;
const ev = (message, time) => ({ id: `e${++seq}`, time, event: 'message', message: typeof message === 'string' ? message : JSON.stringify(message) });

async function device() {
  const pair = await crypto.subtle.generateKey(ALG, false, ['sign', 'verify']);
  const pub = L.b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
  const kid = await L.kidOf(pub);
  const sign = async msg => ({ ...msg, sig: L.b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(L.canonical(msg)))) });
  return {
    pub, kid,
    msg: (t, m, fields = {}, ts = Date.now()) => sign({ v: 1, t, m, ts, kid, ...fields }),
    claim: (m, time) => sign({ v: 1, t: 'claim', m, ts: time * 1000, kid, pub, tz: 'America/Sao_Paulo', l: 'Test' }),
  };
}

async function run(state, ...events) {
  const out = await L.applyEvents(state, events);
  return out.length === 1 ? out[0] : out;
}

test('a free name is claimed at once; a taken one needs approval', async () => {
  const s = L.normalize(null);
  const a = await device(), b = await device();
  assert.equal((await run(s, ev(await a.claim('gonza', at(21)), at(21)))).code, 'joined');
  assert.equal((await run(s, ev(await b.claim('gonza', at(21)), at(21)))).code, 'requested');
  const g = () => s.members.find(m => m.id === 'gonza');
  assert.deepEqual(g().keys.map(k => k.kid), [a.kid]);
  assert.equal(g().requests.length, 1);
  assert.equal(L.codeOf(b.kid).length, 4);

  // b cannot approve itself; a can
  assert.equal((await run(s, ev(await b.msg('approve', 'gonza', { k: b.kid }), at(21)))).code, 'unknownKey');
  assert.equal((await run(s, ev(await a.msg('approve', 'gonza', { k: b.kid }), at(21)))).code, 'approved');
  assert.deepEqual(g().keys.map(k => k.kid), [a.kid, b.kid]);
  assert.equal(L.toView(s).members.find(m => m.id === 'gonza').joined, true);
});

test('steps need a valid signature from one of the member’s keys', async () => {
  const s = L.normalize(null);
  const a = await device(), x = await device();
  await run(s, ev(await a.claim('luis', at(21)), at(21)), ev(await x.claim('minerva', at(21)), at(21)));
  const i = L.datesOf(s.challenge).indexOf('2026-10-21');
  const luis = () => s.members.find(m => m.id === 'luis');

  assert.equal((await run(s, ev(await a.msg('log', 'luis', { d: '2026-10-21', s: 8432 }), at(21)))).code, 'steps');
  assert.equal(luis().daily[i], 8432);
  assert.equal(luis().lastSource, 'app');

  assert.equal((await run(s, ev(await x.msg('log', 'luis', { d: '2026-10-21', s: 99999 }), at(21)))).code, 'unknownKey');
  const forged = { ...(await a.msg('log', 'luis', { d: '2026-10-21', s: 1000 })), s: 50000 };
  assert.equal((await run(s, ev(forged, at(21)))).code, 'badSignature');
  assert.equal(luis().daily[i], 8432);
});

test('manual edits are last-write-wins by timestamp; auto-sync only raises', async () => {
  const s = L.normalize(null);
  const a = await device();
  await run(s, ev(await a.claim('eron', at(21)), at(21)));
  const i = L.datesOf(s.challenge).indexOf('2026-10-21');
  const eron = () => s.members.find(m => m.id === 'eron');
  const t0 = at(21) * 1000;

  await run(s, ev(await a.msg('log', 'eron', { d: '2026-10-21', s: 7000 }, t0 + 2000), at(21)));
  assert.equal((await run(s, ev(await a.msg('log', 'eron', { d: '2026-10-21', s: 9000 }, t0 + 1000), at(21)))).code, 'stale');
  assert.equal(eron().daily[i], 7000);

  const key = 'shortcut-key-123';
  await run(s, ev(await a.msg('synckey', 'eron', { h: await L.sha256Hex(key) }, t0), at(21)));
  assert.equal((await run(s, ev(`sync eron ${key} 12.345`, at(21) + 60))).code, 'steps');
  assert.equal(eron().daily[i], 12345);
  assert.equal((await run(s, ev(`sync eron ${key} 4000`, at(21) + 120))).code, 'unchanged');
  assert.equal(eron().daily[i], 12345);
  assert.equal(eron().autoSyncs, 2);
  assert.equal((await run(s, ev(`sync eron wrong-key 20000`, at(21) + 180))).code, 'badSyncKey');
  assert.equal((await run(s, ev(`sync eron ${key} 11000 2026-10-20`, at(21) + 240))).code, 'steps');
  assert.equal(eron().daily[i - 1], 11000);

  // A later manual correction can lower the value again
  await run(s, ev(await a.msg('log', 'eron', { d: '2026-10-21', s: 10000 }, at(21) * 1000 + 600000), at(21) + 600));
  assert.equal(eron().daily[i], 10000);
});

test('dates are checked in the member’s time zone', async () => {
  const s = L.normalize(null);
  const a = await device();
  await run(s, ev(await a.claim('armando', at(21)), at(21)));
  const log = async (d, time) => (await run(s, ev(await a.msg('log', 'armando', { d, s: 5000 }, time * 1000), time))).code;
  assert.equal(await log('2026-10-19', at(21)), 'notStarted');
  assert.equal(await log('2026-10-25', at(21)), 'futureDay');
  assert.equal(await log('2026-10-22', at(21)), 'steps');            // tomorrow is tolerated (time zones)
  assert.equal(await log('2026-11-16', at(21)), 'ended');
  assert.equal(await log('2026-11-15', Date.UTC(2026, 10, 30, 12) / 1000), 'closed');
  assert.equal(await log('2026-11-15', Date.UTC(2026, 10, 20, 12) / 1000), 'steps'); // grace week
  // 01:00 UTC on Oct 21 is still Oct 20 in Mexico City
  assert.equal(L.localDate(Date.UTC(2026, 9, 21, 1) * 1, 'America/Mexico_City'), '2026-10-20');
});

test('the captain can reset a member; nobody else can', async () => {
  const s = L.normalize(null);
  const captain = await device(), g = await device(), r = await device();
  await run(s, ev(await captain.claim('eron', at(21)), at(21)), ev(await g.claim('gonza', at(21)), at(21)), ev(await r.claim('rogelio', at(21)), at(21)));
  assert.equal((await run(s, ev(await r.msg('reset', 'gonza'), at(21)))).code, 'unknownKey');
  assert.equal((await run(s, ev(await g.msg('reset', 'gonza'), at(21)))).code, 'notAllowed');
  assert.equal((await run(s, ev(await captain.msg('reset', 'gonza'), at(21)))).code, 'reset');
  assert.equal(s.members.find(m => m.id === 'gonza').keys.length, 0);
  // and the captain can approve someone else's new device
  const g2 = await device();
  await run(s, ev(await g.claim('gonza', at(21)), at(21)), ev(await g2.claim('gonza', at(21)), at(21)));
  assert.equal((await run(s, ev(await captain.msg('approve', 'gonza', { k: g2.kid }), at(21)))).code, 'approved');
});

test('requests can be cancelled by the requester; devices can be revoked', async () => {
  const s = L.normalize(null);
  const a = await device(), b = await device();
  await run(s, ev(await a.claim('sidnei', at(21)), at(21)), ev(await b.claim('sidnei', at(21)), at(21)));
  assert.equal((await run(s, ev(await b.msg('deny', 'sidnei', { k: b.kid }), at(21)))).code, 'denied');
  const m = s.members.find(x => x.id === 'sidnei');
  assert.equal(m.requests.length, 0);
  assert.equal((await run(s, ev(await a.msg('revoke', 'sidnei', { k: a.kid }), at(21)))).code, 'revoked');
  assert.equal(m.keys.length, 0);
});

test('avatars, replays and roster merging', async () => {
  const s = L.normalize(null);
  const a = await device();
  const claim = ev(await a.claim('helbert', at(21)), at(21));
  await run(s, claim);
  assert.equal((await run(s, ev(await a.msg('avatar', 'helbert', { a: 'm13' }), at(21)))).code, 'avatar');
  assert.equal((await run(s, ev(await a.msg('avatar', 'helbert', { a: 'zz9' }), at(21)))).code, 'badAvatar');
  assert.equal(L.toView(s).members.find(m => m.id === 'helbert').avatar, 'm13');

  assert.deepEqual(await L.applyEvents(s, [claim]), []); // already seen → skipped
  assert.equal((await run(s, ev('not json', at(21)))).code, 'notJson');

  const again = L.normalize(JSON.parse(JSON.stringify(s)));
  assert.equal(again.members.find(m => m.id === 'helbert').avatar, 'm13');
  assert.equal(again.members.length, 9);
  assert.equal(again.members[0].daily.length, L.datesOf(again.challenge).length);
});

test('step parsing accepts the formats phones produce', () => {
  assert.equal(L.parseSteps('12,345'), 12345);
  assert.equal(L.parseSteps('12.345'), 12345);
  assert.equal(L.parseSteps('12345,0'), 12345);
  assert.equal(L.parseSteps('8432'), 8432);
  assert.equal(L.parseSteps(''), null);
  assert.equal(L.parseSteps('abc'), null);
});
