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

Then pick your name, create a 4-digit PIN and turn on **Auto-sync**.

## Features

**Team dashboard**
- Team progress ring toward 2.43M steps, live “today” board with everyone's ring, goal-pace projection
- Daily team chart (with the 90K team goal line) and running total vs goal pace
- “Who walked when” heatmap (member × day) with 10K markers
- Team expedition: real distances between our home cities (Montevideo → Punta del Este, Bogotá → Medellín,
  Mexico City → Acapulco, Rio → São Paulo, Camino de Santiago, São Paulo → Montevideo, Bogotá → Mexico City)
- Fun facts: % around the Earth, CO₂ a car would emit, calories in tacos 🌮, arepas 🫓, empanadas 🥟, brigadeiros 🍫, alfajores 🍪

**Ranking**: Total, this week, today, daily average, 10K days, streak, plus a podium and Hall of Fame cards.

**Me**: today's ring, streaks, best day, consistency, projection, your daily steps vs the team average, weekday rhythm.
Also 17 badges and health metrics: distance, active calories, walking time, fat-energy, CO₂, BMI, WHO weekly activity,
Tudor-Locke activity level, and evidence cards (Lancet 2022, EJPC 2023, JAMA Neurology 2022, WHO 2020).
Details in [docs/METRICS.md](docs/METRICS.md).

## Automatic step updates

| Phone | How | Effort |
|---|---|---|
| **iPhone** | An Apple **Shortcuts** automation reads Apple Health and calls your personal sync link at 12:00, 18:00 and 23:30 | Set up once (~2 min), then fully automatic |
| **Android** | **Share a screenshot** of any health app (Samsung Health, Google Fit, Fitbit, Garmin…) to *Team 8 Steps*. The app reads the number with on-device OCR | 2 taps |
| Android power users | Tasker / MacroDroid / HTTP Shortcuts call the same sync link | Set up once |
| Everyone | Quick manual entry (+500/+1K chips), backfill past days, works offline (queued), daily 9 PM calendar reminder | Seconds |

Automatic syncs never lower a day's value, so running them several times a day is safe. See [docs/IOS_SHORTCUT.md](docs/IOS_SHORTCUT.md).

## For the organizer

1. Deploy the backend (Google Sheet + Apps Script, ~5 minutes): **[docs/SETUP.md](docs/SETUP.md)**
2. Paste the Web App URL into [`js/config.js`](js/config.js) → `API_URL` and commit
3. Share the message in [docs/ANNOUNCEMENT.md](docs/ANNOUNCEMENT.md) 🎉

Until `API_URL` is set, the app runs in **demo mode** with sample data. You can preview any day with
`?demo=1&asOf=2026-11-04`.

## Architecture

```
Phone (PWA, GitHub Pages)  ──GET ?action=data──────────▶  Google Apps Script  ──▶  Google Sheet
   │  log / claim (POST)  ─────────────────────────────▶   (backend/Code.gs)        Steps · Members · Log
iPhone Shortcut  ──GET ?action=sync&m=…&t=…&steps=N──▶
```

- **Frontend**: vanilla JavaScript modules, no build step, hand-made SVG charts, system font, light/dark themes,
  service worker (offline shell, update prompt, Android share target), Web App Manifest with shortcuts.
- **Backend**: one Apps Script file. PINs are stored as salted hashes, each member gets a sync key, script lock
  for concurrent writes, 20 s cache, audit log, PIN lockout.
- **Data**: a normal Google Sheet with the same layout as the original Excel (one row per member, one column per day).

```
index.html · manifest.webmanifest · sw.js
css/app.css
js/  app.js (shell & flows) · views.js (pages) · charts.js (SVG) · metrics.js (health & stats) · api.js · ui.js · ocr.js · config.js
backend/  Code.gs · test-harness.js
tools/  dev_server.py · make_icons.py · make_invites.py
docs/  SETUP.md · IOS_SHORTCUT.md · METRICS.md · ANNOUNCEMENT.md
```

## Development

```bash
python tools/dev_server.py          # http://localhost:8765/?demo=1  (no-cache; service worker off on localhost, add &sw to test it)
node backend/test-harness.js        # backend tests with mocked Google services
python tools/make_icons.py          # regenerate icons
```

When you release, bump `VERSION` in `sw.js` so installed apps pick up the new files.

## Privacy

Names and daily step counts are visible to the team. PINs are hashed. Height and weight entered in the app never
leave your phone. The original spreadsheet (with phone numbers) is not part of this repository.

---
*Made with 💙 for Team 8. Health numbers are estimates, not medical advice.*
