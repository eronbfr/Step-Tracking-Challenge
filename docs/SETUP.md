# Backend setup (organizer · ~5 minutes)

The app is a static PWA on GitHub Pages. Steps are stored in a **Google Sheet** that you own, through a tiny
**Google Apps Script** web app. Nothing to install, no server, free.

## 1. Create the Google Sheet

1. Open <https://sheets.new> (signed in with the Google account that should own the data).
2. Name it **Team 8 Step Challenge**.

## 2. Add the script

1. In the sheet: **Extensions → Apps Script**.
2. Delete everything in `Code.gs` and paste the full content of [`backend/Code.gs`](../backend/Code.gs).
3. Click **Save** (💾).

## 3. Run the one-time setup

1. In the toolbar, pick the function **`setup`** and click **Run**.
2. Google asks for permission → **Review permissions** → choose your account →
   **Advanced** → **Go to Team 8 Step Challenge (unsafe)** → **Allow**.
   *(“Unsafe” only means the script isn't published by Google — it's your own code, and it only touches this sheet.)*
3. Go back to the sheet: you now have the tabs **Steps**, **Members** and **Log**.

## 4. Deploy it as a web app

1. **Deploy → New deployment** → click the ⚙️ next to “Select type” → **Web app**.
2. Description: `Team 8 API` · **Execute as: Me** · **Who has access: Anyone**.
3. **Deploy** and copy the **Web app URL** (it ends with `/exec`).
4. Quick test: open `YOUR_URL?action=data` in the browser — you should see JSON with the 9 members.

## 5. Connect the app

Edit [`js/config.js`](../js/config.js) and paste the URL:

```js
API_URL: 'https://script.google.com/macros/s/AKfy.../exec',
```

Commit (on GitHub you can edit the file directly with the ✏️ button). GitHub Pages republishes in ~1 minute
and the app leaves demo mode. Also bump `VERSION` in [`sw.js`](../sw.js) on every release so installed apps update.

---

## Day-to-day admin (all in the Google Sheet)

| Task | How |
|---|---|
| Fix someone's steps | Edit the cell in **Steps** (the app refreshes within ~20 s) |
| Reset a forgotten PIN | In **Members**, clear that person's `pinHash` **and** `token` cells. They create a new PIN in the app and must update their Shortcut link |
| See who synced when | **Members** → `lastSyncAt`, `lastSource`, `autoSyncs` · full history in **Log** |
| Change someone's avatar | **Members** → `avatar` (`f1`–`f5`, `m1`–`m5`, empty = initials) |
| Add a member | Add them to `ROSTER` in `Code.gs` and run `setup` again (data, PINs and keys are preserved) |
| Export to Excel | **File → Download → Microsoft Excel** |

## Updating the script later

After editing `Code.gs`: **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.
The URL stays the same.

**Upgrading from v1.0 → v1.1** (languages + avatars): paste the new `Code.gs` and deploy a new version as above.
The `avatar` column in **Members** is created automatically the first time someone picks an avatar
(or run `setup` once to add it right away — steps, PINs and keys are preserved).

## Testing the backend locally

```bash
node backend/test-harness.js
```

Runs the backend against mocked Google services (setup, PINs, logging, sync, validation, lockout, avatars, languages).

## Security notes

- Public read (`action=data`) only returns names, avatars and step counts.
- Writes need a per-member **sync key** (random, 32 hex chars) obtained by entering the member's PIN.
- PINs are stored as salted SHA-256 hashes; 8 wrong PINs lock that member for 15 minutes.
- Automatic syncs use “max” semantics — they can never lower a day's value. Manual edits in the app can.
- Keep the **Members** tab private (don't share the sheet publicly).
