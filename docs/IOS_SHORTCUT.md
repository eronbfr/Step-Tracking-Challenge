# iPhone auto-sync with Apple Shortcuts

A Shortcut reads today's step count from **Apple Health** and sends it to the team, automatically,
several times a day. Once it's set up nobody needs to type anything.

Each member's **personal sync link** is in the app → **Auto-sync** tab → *Create my link* / *Copy my link*. It looks like:

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
6. *(optional)* **Show Notification** — “✅ Team 8 synced”

Name it **Team 8 Sync**, run it once (allow Health access), then:
**Automation → + → Time of Day → 12:00 · Daily → Run Immediately → Team 8 Sync**. Repeat for 18:00 and 23:30.

## Option B — share one Shortcut with everybody (recommended for the organizer)

Build it once with an **Import Question**, share the iCloud link, and members only paste their link:

1. Build the Shortcut as in Option A, but in step 4 paste a placeholder such as `PASTE-YOUR-LINK` followed by the
   *Rounded Number* variable.
2. Tap the **ⓘ / Settings** of the Shortcut → **Setup** → **Add Import Question** → select the *Text* action's
   placeholder → question: *“Paste your personal sync link from the Team 8 app (Auto-sync tab)”*.
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

Tasker, MacroDroid or HTTP Shortcuts can call the same link (`…%208432`, optional `%202026-10-21` after the steps).
For everyone else the app's **screenshot import** (share a screenshot of any health app to *Team 8 Steps*)
is the fastest route.
