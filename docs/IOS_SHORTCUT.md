# iPhone auto-sync with Apple Shortcuts

A Shortcut reads today's step count from **Apple Health** and sends it to the team, automatically,
several times a day. Once it's set up nobody needs to type anything.

Each member's **personal sync link** is in the app → ⚙️ **Settings → Auto-sync** → *Create my link* / *Copy my link*. It looks like:

```
https://ntfy.sh/t8steps-2026-o58d4zb7pyzw/publish?message=sync%20eron%20<sync-key>%20
```

The step count is appended at the end. The message lands on the team relay, every open app shows it within a
second, and the Ledger Action stores it in the repository and the spreadsheet a few minutes later. Automatic
syncs only ever **raise** a day's value, so running the Shortcut several times a day is safe.

## Option A — members build it themselves (in-app guide, ~2 min)

1. **Find Health Samples** — Type *is* Steps · Start Date *is today* · Group by *Day*
2. **Calculate Statistics** — *Sum* of Health Samples
3. **Round Number** — *Ones Place*
4. **Text** — paste the personal link, then insert the *Rounded Number* variable at the very end
5. **Get Contents of URL** — URL = *Text*
6. **Show Notification** — “✅ Team 8:” followed by the *Rounded Number* variable, so a 0 is visible right away

Name it **Team 8 Sync**, run it once (allow Health access), then:
**Automation → + → App → WhatsApp, Instagram, Teams… (apps opened every day) → Is Closed → Run Immediately → Team 8 Sync**.

Why not *Time of Day*? iOS encrypts Health data while the iPhone is locked: a 12:00 automation on a locked phone
reads nothing and sends **0**. Closing an app means the phone is unlocked, so the read always works.

### It sends 0 steps

- Health app → profile picture → **Apps → Shortcuts** → turn on **Steps** (a denied permission reads as 0, silently).
- Use the *App → Is Closed* trigger above, not a time of day.
- The ledger ignores a Shortcut sync of 0 (and a link opened without a number): the day is never overwritten, and
  the member's app shows a warning on ⚙️ Settings → Auto-sync until the next good sync.

## Option B — share one Shortcut with everybody (recommended for the organizer)

Build it once with an **Import Question**, share the iCloud link, and members only paste their link:

1. Build the Shortcut as in Option A, but in step 4 paste a placeholder such as `PASTE-YOUR-LINK` followed by the
   *Rounded Number* variable.
2. Tap the **ⓘ / Settings** of the Shortcut → **Setup** → **Add Import Question** → select the *Text* action's
   placeholder → question: *“Paste your personal sync link from the Team 8 app (Settings → Auto-sync)”*.
3. **Share → Copy iCloud Link**.
4. Paste it in [`js/config.js`](../js/config.js) as `IOS_SHORTCUT_URL` and commit. The app then shows an
   **Add Shortcut** button instead of the build instructions.

### More robust variant (catches late-evening steps)

Instead of *Start Date is today*, use *Start Date is in the last 2 days* (Group by *Day*), then
**Repeat with Each** sample: **Format Date** (custom `yyyy-MM-dd`) of the sample's *Start Date*, and call
`<link><steps>%20<formatted date>`. Because automatic syncs keep the highest value per day, re-sending
yesterday is always safe.

## The link is personal

It can only raise the steps of the person it belongs to. If it leaks, open the app → Auto-sync → **New link**
and paste the new one in the Shortcut (the old link stops working right away). The link lives on the device that
created it; creating one on another device replaces it.

## Android power users

Android gives web apps no access to step data, so the link alone does nothing: an automation app must open it with
today's steps at the end (`…%208432`, optional `%202026-10-21` after the steps). The in-app guide uses:

1. Samsung Health (or Google Fit / Fitbit) → Settings → **Health Connect** → allow Steps.
2. **Tasker** + the free [Tasker Health Connect](https://github.com/RafhaanShah/TaskerHealthConnect) plugin
   (open it once, allow Steps).
3. Task: plugin aggregate read of `StepsRecord.COUNT_TOTAL` from today 00:00 to now (the total comes back as
   `longValues.Steps_count_total`) → **HTTP Request** GET `<link><total>`.
4. Profile: Time 08:00–23:59, every 2 h.

For everyone else the app's **screenshot import** (share a screenshot of any health app to *Team 8 Steps*)
is the fastest route.
