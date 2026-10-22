// Stories media — run by backend/publish.sh right after the fold.
//
// The app uploads a story's photo/video to the relay as attachments (ntfy.sh keeps them for 3 hours only).
// This copies each live story's media into the `stories` branch (checked out at --dir) and removes what expired,
// so the branch only ever holds the last day of stories; publish.sh force-pushes it as a single commit.
//
//   node backend/stories.mjs --dir <stories checkout>            download new media, drop expired files
//   node backend/stories.mjs --mark <file listing the branch>    set `src` in data/data.json for the files on the branch
import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../js/config.js';
import * as L from '../js/ledger.js';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.resolve(opt('--root', path.join(path.dirname(fileURLToPath(import.meta.url)), '..')));
const DATA = path.join(ROOT, 'data', 'data.json');
const RELAY_HOST = new URL(opt('--relay', process.env.RELAY_URL || CONFIG.RELAY_URL)).host;
const KEEP_FILES = L.STORY.TTL + 2 * 3600; // a little longer than the app shows them
const now = Math.floor(Date.now() / 1000);

const data = JSON.parse(await readFile(DATA, 'utf8'));
const stories = Array.isArray(data.stories) ? data.stories : [];
const fileOf = s => `${s.id}.${L.STORY.MIME[s.mt] || 'bin'}`;

if (args.includes('--mark')) {
  const listing = new Set((await readFile(opt('--mark'), 'utf8')).split('\n').map(x => x.trim()).filter(Boolean));
  let changed = 0;
  for (const s of stories) {
    const src = listing.has(fileOf(s)) ? fileOf(s) : '';
    if ((s.src || '') !== src) { s.src = src; changed++; }
  }
  if (changed) {
    const pretty = JSON.stringify(data, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, inner) => `[${inner.split(/,\s+/).join(', ')}]`);
    await writeFile(DATA, `${pretty}\n`);
  }
  console.log(`Stories: ${changed} snapshot entr${changed === 1 ? 'y' : 'ies'} updated`);
  process.exit(0);
}

const DIR = path.resolve(opt('--dir', ''));
const live = stories.filter(s => s.at > now - KEEP_FILES);
const wanted = new Set(live.map(fileOf));
const present = new Set((await readdir(DIR)).filter(f => !f.startsWith('.')));

let removed = 0, added = 0;
for (const f of present) if (!wanted.has(f)) { await unlink(path.join(DIR, f)); removed++; }

for (const s of live) {
  const file = fileOf(s);
  if (present.has(file)) continue;
  try {
    if (!s.p.every(u => new URL(u).host === RELAY_HOST)) throw new Error('media is not on the relay');
    const parts = [];
    for (const u of s.p) {
      const res = await fetch(u, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      parts.push(Buffer.from(await res.arrayBuffer()));
    }
    const buf = Buffer.concat(parts);
    const sha = createHash('sha256').update(buf).digest('hex');
    if (buf.length !== s.sz || sha !== s.sha) throw new Error(`checksum mismatch (${buf.length} bytes)`);
    await writeFile(path.join(DIR, file), buf);
    added++;
    console.log(`✓ ${file} (${s.m}, ${Math.round(buf.length / 1024)} KB)`);
  } catch (e) {
    console.log(`✗ ${file} (${s.m}): ${e.message}${s.at < now - 3 * 3600 ? ' — the relay copy has expired' : ''}`);
  }
}
console.log(`Stories: ${added} added, ${removed} removed, ${wanted.size} live`);
