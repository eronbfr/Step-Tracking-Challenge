# 👟 Team 8 · Step Challenge

**Oct 20 – Nov 15, 2026 · 10,000 steps a day · 9 teammates 🇲🇽 🇺🇾 🇧🇷 🇨🇴**

A Progressive Web App (installable, works offline) for the Team 8 step challenge. It has a live team dashboard,
automatic step sync from your phone, friendly rankings, badges and health insights.

### ▶️ Open the app: **https://eronbfr.github.io/Step-Tracking-Challenge/**

| Team dashboard | Ranking | Me | Auto-sync |
|---|---|---|---|
| ![Team](docs/screenshots/team.jpg) | ![Ranking](docs/screenshots/ranking.jpg) | ![Me](docs/screenshots/me.jpg) | ![Auto-sync](docs/screenshots/sync.jpg) |

## Install it like a native app

- **iPhone**: open the link in **Safari** → Share → **Add to Home Screen**
- **Android**: open the link in **Chrome** → ⋮ → **Install app**

Then pick your language and your name (no password: your phone is your key), choose your avatar and turn on **Auto-sync**.

## Features

**Team dashboard**
- Team progress ring toward 2.43M steps, live “today” board with everyone's ring, goal-pace projection
- Daily team chart (with the 90K team goal line) and running total vs goal pace
- “Who walked when” heatmap (member × day) with 10K markers
- Team expedition: real distances between our home cities (Montevideo → Punta del Este, Bogotá → Medellín,
  Mexico City → Acapulco, Rio → São Paulo, Camino de Santiago, São Paulo → Montevideo, Bogotá → Mexico City)
- Fun facts: % around the Earth, CO₂ a car would emit, calories in tacos 🌮, arepas 🫓, empanadas 🥟, brigadeiros 🍫, alfajores 🍪

**Ranking**: Total, this week, today, daily average, 10K days, streak, plus a podium and Hall of Fame cards.

**Everywhere**
- 🌐 Three languages — **English** (default), **Português (Brasil)** and **Español**. Picked on the first screen,
  changeable any time in ⚙️ **Settings** (gear icon at the top of every page and in *Me*). Numbers and dates follow
  the language (10,000 · 10.000), and the backend answers errors and the iPhone Shortcut reply in it too.
- 🧑‍🎨 Avatar library — the 36 illustrated avatars of the Sintonia app (15 female, 21 male). The one you pick is
  shown to the whole team: today board, ranking, podium, heatmap, member cards, sign-in.
- ⚡ Live — when anyone logs steps, every open app updates within a second.

**Me**: today's ring, streaks, best day, consistency, projection, your daily steps vs the team average, weekday rhythm.
Also 17 badges and health metrics: distance, active calories, walking time, fat-energy, CO₂, BMI, WHO weekly activity,
Tudor-Locke activity level, and evidence cards (Lancet 2022, EJPC 2023, JAMA Neurology 2022, WHO 2020).
Details in [docs/METRICS.md](docs/METRICS.md).

## Automatic step updates

| Phone | How | Effort |
|---|---|---|
| **iPhone** | An Apple **Shortcuts** automation reads Apple Health and opens your personal sync link at 12:00, 18:00 and 23:30 | Set up once (~2 min), then fully automatic |
| **Android** | **Share a screenshot** of any health app (Samsung Health, Google Fit, Fitbit, Garmin…) to *Team 8 Steps*. The app reads the number with on-device OCR | 2 taps |
| Android power users | Tasker / MacroDroid / HTTP Shortcuts call the same sync link | Set up once |
| Everyone | Quick manual entry (+500/+1K chips), backfill past days, works offline (queued), daily 9 PM calendar reminder | Seconds |

Automatic syncs never lower a day's value, so running them several times a day is safe. See [docs/IOS_SHORTCUT.md](docs/IOS_SHORTCUT.md).

## For the organizer

Nothing to deploy — the backend is this repository (details in **[docs/SETUP.md](docs/SETUP.md)**):

1. Open the app and **sign in as yourself first** — `eron` is the team captain (`ADMINS` in [`js/config.js`](js/config.js)),
   whose devices can approve sign-ins and reset anyone.
2. Share the message in [docs/ANNOUNCEMENT.md](docs/ANNOUNCEMENT.md) 🎉
3. The team spreadsheet [`step-tracking_Team8.xlsx`](step-tracking_Team8.xlsx) updates itself a few minutes after
   every change (also downloadable from ⚙️ → Team captain).

`?demo` shows sample data; `?demo&asOf=2026-11-04` previews another day.

## Architecture

```
 PWA (GitHub Pages) ──signed message──▶ relay topic (ntfy.sh) ──live──▶ every open app
        ▲                                     │ every ~5 min
        │                                     ▼
        └──── data/data.json ◀── GitHub Action "Ledger": backend/fold.mjs + backend/sheet.py ──▶ step-tracking_Team8.xlsx
```

- **Frontend**: vanilla JavaScript modules, no build step, hand-made SVG charts, system font, light/dark themes,
  service worker (offline shell, update prompt, Android share target), Web App Manifest with shortcuts.
- **Backend**: an event-sourced ledger ([`js/ledger.js`](js/ledger.js)) shared by the app and a scheduled GitHub
  Action. Each device signs its messages with its own ECDSA key (WebCrypto); public keys live in `data/data.json`.
  Device approval with a 4-digit code, captain reset, sync keys for the iPhone Shortcut, offline queue and resend.
- **Data**: `data/data.json` (snapshot), `data/log.csv` (every change) and the original Excel file, kept up to date.

```
index.html · manifest.webmanifest · sw.js · package.json
css/app.css
avatars/  36 WebP avatars (imported from Sintonia by tools/import_avatars.py)
js/  app.js (shell & flows) · views.js (pages) · charts.js (SVG) · metrics.js (health & stats) · ui.js · ocr.js · config.js
     api.js (snapshot + relay + outbox) · ledger.js (rules, shared with the Action) · device.js (signing key)
     i18n.js + strings.js (en / pt / es) · avatars.js (avatar library)
data/  data.json · log.csv                    ← written by the Action
backend/  fold.mjs · sheet.py · publish.sh · ledger.test.mjs
.github/workflows/ledger.yml
tools/  dev_server.py · mock_relay.py · import_avatars.py · make_icons.py · make_invites.py
docs/  SETUP.md · IOS_SHORTCUT.md · METRICS.md · ANNOUNCEMENT.md
```

## Development

```bash
python tools/dev_server.py 8765       # app (no-cache; service worker off on localhost, add ?sw to test it)
python tools/mock_relay.py 8766       # local relay → http://localhost:8765/?relay=http://localhost:8766
node --test backend/ledger.test.mjs   # ledger rules
python tools/make_icons.py            # regenerate icons
```

When you release, bump `VERSION` in `sw.js` so installed apps pick up the new files. The Action commits to `main`
every few minutes while people log steps, so `git pull --rebase` before you push.

## Privacy

Names, avatars and daily step counts are visible to the team and stored in this public repository, together with the
team spreadsheet. Sign-in uses a key that never leaves your device. Height and weight entered in the app never
leave your phone.

---
*Made with 💙 for Team 8. Health numbers are estimates, not medical advice.*
