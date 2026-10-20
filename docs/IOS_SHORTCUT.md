# iPhone auto-sync with Apple Shortcuts

A Shortcut reads today's step count from **Apple Health** and sends it to the team sheet, automatically,
several times a day. Once it's set up nobody needs to type anything.

Each member's **personal sync link** is in the app → **Auto-sync** tab → *Copy my link*. It looks like:

```
https://script.google.com/macros/s/…/exec?action=sync&m=eron&t=<sync-key>&steps=
```

The step count is appended at the end. The server answers in plain text, e.g. `✅ 8,432 steps saved for Tue, Oct 20`.

## Option A — members build it themselves (in-app guide, ~2 min)

1. **Find Health Samples** — Type *is* Steps · Start Date *is today* · Group by *Day*
2. **Calculate Statistics** — *Sum* of Health Samples
3. **Round Number** — *Ones Place*
4. **Text** — paste the personal link, then insert the *Rounded Number* variable at the very end
5. **Get Contents of URL** — URL = *Text*
6. *(optional)* **Show Notification** — *Contents of URL*

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
`<link><steps>&date=<formatted date>`. Because automatic syncs keep the highest value per day, re-sending
yesterday is always safe.

## Android power users

Tasker, MacroDroid or HTTP Shortcuts can call the same link (`…&steps=8432`, optional `&date=2026-10-21`).
For everyone else the app's **screenshot import** (share a screenshot of any health app to *Team 8 Steps*)
is the fastest route.
