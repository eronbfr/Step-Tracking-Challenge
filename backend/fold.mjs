// Ledger fold — run by .github/workflows/ledger.yml every few minutes (backend/publish.sh).
// Reads data/data.json, applies the relay's new events with js/ledger.js (the very code the app runs), and
// writes the new snapshot plus data/log.csv. backend/sheet.py then mirrors it into step-tracking_Team8.xlsx.
//
//   node backend/fold.mjs [--offline] [--relay <url>] [--dir <repo root>] [--summary-file <path>]
import { readFile, writeFile, appendFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../js/config.js';
import * as L from '../js/ledger.js';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.resolve(opt('--dir', path.join(path.dirname(fileURLToPath(import.meta.url)), '..')));
const RELAY = `${opt('--relay', process.env.RELAY_URL || CONFIG.RELAY_URL)}/${CONFIG.RELAY_TOPIC}`;
const DATA = path.join(ROOT, 'data', 'data.json');
const LOG = path.join(ROOT, 'data', 'log.csv');
const SUMMARY = opt('--summary-file', '');
const LOG_EVENTS = ['steps', 'joined', 'requested', 'approved', 'denied', 'revoked', 'reset', 'avatar', 'synckey', 'story', 'unstory'];

const readJson = async f => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; } };
const exists = f => access(f).then(() => true, () => false);

/** Pretty JSON with flat number arrays (daily/stamps stay on one line → readable diffs). */
const pretty = obj => JSON.stringify(obj, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, inner) => `[${inner.split(/,\s+/).join(', ')}]`);
const csv = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

async function relayEvents(since) {
  const res = await fetch(`${RELAY}/json?poll=1&since=${since}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.text()).split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(e => e && e.event === 'message');
}

const prev = await readJson(DATA);
const before = L.normalize(prev);
const state = L.normalize(prev);

let events = [];
if (!args.includes('--offline')) {
  const since = state.cursor.time ? state.cursor.time - 600 : 'all';
  try {
    events = await relayEvents(since);
  } catch (e) {
    console.log(`::warning::Relay unreachable (${e.message}) — nothing folded this time.`);
    process.exit(0);
  }
  console.log(`Relay: ${events.length} event(s) since ${since === 'all' ? 'the start' : new Date(since * 1000).toISOString()}`);
}

const results = await L.applyEvents(state, events);
const names = Object.fromEntries(state.members.map(m => [m.id, m.name]));
for (const r of results) {
  const what = r.d ? ` ${r.d} → ${r.s}` : '';
  console.log(`${r.ok ? '✓' : '✗'} ${new Date(r.time * 1000).toISOString()} ${r.t || '?'} ${r.m || '?'} ${r.code}${what}`);
}

const changedMembers = JSON.stringify(state.members) !== JSON.stringify(before.members)
  || JSON.stringify(state.stories) !== JSON.stringify(before.stories); // stories, views, reactions
const changedConfig = !prev || prev.v !== L.VERSION || JSON.stringify(state.challenge) !== JSON.stringify(prev.challenge);
// Even with nothing valid to apply, move the cursor now and then so the relay window clients read stays short.
const cursorStale = results.length > 0 && state.cursor.time - before.cursor.time > 6 * 3600;

if (!changedMembers && !changedConfig && !cursorStale) {
  console.log('No changes.');
  process.exit(0);
}

state.updatedAt = new Date().toISOString();
await mkdir(path.dirname(DATA), { recursive: true });
await writeFile(DATA, `${pretty(state)}\n`);

const rows = results.filter(r => r.ok && LOG_EVENTS.includes(r.code));
if (!(await exists(LOG))) await writeFile(LOG, 'time,member,name,event,date,steps,previous,source\n');
if (rows.length) {
  await appendFile(LOG, rows.map(r => [new Date(r.time * 1000).toISOString(), r.m, names[r.m], r.code, r.d, r.s, r.before, r.source].map(csv).join(',')).join('\n') + '\n');
}

const steps = rows.filter(r => r.code === 'steps');
const stories = rows.filter(r => r.code === 'story');
const other = rows.length - steps.length - stories.length;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const who = [...new Set(rows.map(r => r.m))];
const summary = rows.length
  ? `data: ${[steps.length && plural(steps.length, 'step update'), stories.length && plural(stories.length, 'story'), other && plural(other, 'account event')].filter(Boolean).join(' + ')} (${who.join(', ')})`
  : results.some(r => r.ok) ? 'data: story views & reactions' : 'data: refresh ledger snapshot';
console.log(summary);
if (SUMMARY) await writeFile(SUMMARY, `${summary}\n`);
