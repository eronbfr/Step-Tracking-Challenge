# Backend — how it works and how to run the team

There is **nothing to deploy**. The backend is this GitHub repository:

```
 Phone / laptop (PWA on GitHub Pages)
   │  signed message ──POST──▶  relay topic (ntfy.sh)  ──live (SSE)──▶  every open app, within a second
   │                                   │
   │                                   ▼ every ~5 min
   │                         GitHub Action "Ledger" (.github/workflows/ledger.yml)
   │                           backend/fold.mjs  → data/data.json + data/log.csv
   │                           backend/sheet.py  → step-tracking_Team8.xlsx
   │                           backend/stories.mjs → branch `stories` (story photos & videos)
   │                           commit to main
   ▼
 reads data/data.json (raw.githubusercontent.com + Pages) and replays the newer relay messages on top
```

- **One rulebook.** [`js/ledger.js`](../js/ledger.js) is the state machine. The app runs it to show live data,
  the Action runs the very same file to write the snapshot, so the dashboard and the spreadsheet always agree.
- **Signed writes.** On sign-in each device creates an ECDSA P-256 key (WebCrypto, non-extractable, stored in
  IndexedDB). Every message is signed; the public key is stored in `data/data.json`. Nobody can log steps for
  someone else, and there is no password to forget.
- **Live for everyone.** Messages go to a public relay topic (`RELAY_TOPIC` in [`js/config.js`](../js/config.js)).
  Every open app is subscribed, so a teammate's steps appear right away. The relay keeps messages for 12 h;
  the Action folds them into the repository every few minutes, so nothing depends on the relay for long.
- **The spreadsheet is the repository's `step-tracking_Team8.xlsx`.** Same layout as before (one row per member,
  one column per day, TOTAL formulas); the Action rewrites the day cells after every change and adds a **Log**
  sheet with the full history. Download it from GitHub or from the app (⚙️ Settings → Team captain).
- **Offline-safe.** Entries made offline are queued and sent when the phone is back online; if a message ever goes
  missing before the Action stored it, the app that wrote it sends it again.

## Signing in

| Situation | What happens |
|---|---|
| First time on a name | Tap the name → *Yes, that's me*. This device is linked immediately |
| A second device (laptop, new phone, iPhone Safari vs installed app) | Tap the name → *Request access* → a 4-digit code appears. Approve the request with the same code on the other device (it pops up there) or ask the captain |
| Lost phone / someone took the wrong name | Captain → ⚙️ **Team captain** → **Reset** next to the name. Steps are kept; the person picks their name again |
| Sign out | ⚙️ Settings → your name → Sign out (removes this device from the ledger) |

On iPhone, Safari and the installed home-screen app keep separate storage, so they count as two devices: install
first, then sign in from the home-screen app (the app says so on the sign-in screen).

## Team captain (`ADMINS` in `js/config.js`, today: `eron`)

The captain's devices can approve any sign-in request and reset anyone. **The captain should sign in first**
(the first device to claim a free name gets it). Everything is in the app: ⚙️ Settings → **Team captain**.

| Task | How |
|---|---|
| Approve a new device | Pops up automatically; also listed in ⚙️ → Team captain |
| Reset someone's sign-in | ⚙️ → Team captain → **Reset** |
| See who synced when | ⚙️ → Team captain (devices · last update) · full history in `data/log.csv` / the **Log** sheet |
| Download the spreadsheet | ⚙️ → Team captain → **Download**, or `step-tracking_Team8.xlsx` on GitHub |
| Fix a wrong number | The person edits that day in the app (latest edit wins). Automatic syncs only ever raise a day |
| Add a member | Add them to `ROSTER` in `js/config.js` and a row (same name) in the spreadsheet; commit. The Action picks it up |

## Stories

```
 composer (js/composer.js) ─ JPEG 1080×1920 / MP4|WebM 720×1280 ≤ 15 s, filters & layers baked in
   │ 1. upload the file to the relay as attachments, ≤ 1.9 MB per part  (message {"t":"blob"}, unsigned)
   │ 2. signed 'story' message: id, parts' URLs, size, SHA-256, kind, size in px, duration, alt text, @mentions
   ▼
 every app: plays it straight from the relay (3-hour copies) ── 'seen' / 'react' / 'reply' / 'unstory' messages
   │
   ▼ Action (backend/stories.mjs, right after the fold)
 downloads the parts, checks size + SHA-256, writes <id>.<ext> to branch `stories` (one fresh commit, force-pushed)
 and sets `src` in data/data.json → apps read older stories from raw.githubusercontent.com/<repo>/stories/
```

- On air for 24 h (`STORY` in [`js/ledger.js`](../js/ledger.js)); the ledger forgets them after 48 h and the branch
  drops the files after ~26 h. Views are sent once per viewing session to keep the relay message count low
  (ntfy.sh allows 250 messages/day and 20 MB of attachments per IP for anonymous use).
- Only the author's devices or the captain can delete a story. Reactions and replies need a signed-in device.
- If the Action is down for more than 3 hours, a story whose relay copy expired shows *not available anymore*.

## Watching the backend

- **Actions** tab on GitHub → *Ledger*: one run every ~5 minutes. Each run lists the messages it applied
  (`✓ … log eron steps 2026-10-21 → 8432`) or rejected (`✗ … badSignature`), and commits only when something changed
  (`data: 3 step updates (eron, gonza)`).
- Run it by hand: Actions → Ledger → **Run workflow**.
- GitHub runs scheduled jobs on a best-effort basis (sometimes 10–20 min apart); the app doesn't wait for it —
  everyone already sees new steps live — the delay only affects the committed snapshot and spreadsheet.

## Security notes

- Everything in the relay and in `data/data.json` is public by design: names, avatars, step counts, device labels
  and **public** keys. No secrets are stored anywhere.
- Messages without a valid signature from one of the member's keys are ignored by both the app and the Action.
- The iPhone Shortcut can't sign, so it uses a personal **sync key**: the ledger stores only its SHA-256 hash, and a
  Shortcut message can only *raise* that member's steps for today (or a given day). A new link (⚙️ Settings →
  Auto-sync → *New link*) invalidates the old one.
- Health profile (height, weight) never leaves the phone.

## Development

```bash
python tools/dev_server.py 8765       # the app, no caching
python tools/mock_relay.py 8766       # a local ntfy-compatible relay
# open http://localhost:8765/?relay=http://localhost:8766   (two origins, e.g. localhost and 127.0.0.1, = two devices)
node backend/fold.mjs --relay http://localhost:8766 --dir <copy of the repo>   # what the Action does
RELAY_URL=http://localhost:8766 bash backend/publish.sh   # the whole Action, in a clone whose origin is a scratch bare repo
python backend/sheet.py <copy of the repo>
node --test backend/ledger.test.mjs   # ledger rules
```

`?demo` shows sample data without touching the relay (`?demo&asOf=2026-11-04` previews another day).
Bump `VERSION` in [`sw.js`](../sw.js) on every release so installed apps update.
