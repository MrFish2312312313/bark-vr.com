# Painting storage + moderation (backend)

`paintings.js` runs on the **bark-manager backend** (the Node/Express server behind
the Cloudflare tunnel) — **not** on this static site. It stores player whiteboard
paintings so the game can print unlimited ones (PlayFab only holds a tiny id), and
gives moderators a way to hide/delete them.

## Install

1. Copy `paintings.js` into the bark-manager project.
2. Mount it once, after `app` is created:

   ```js
   const mountPaintings = require('./paintings');
   mountPaintings(app, { dir: __dirname + '/paintings' }); // where PNGs are stored
   ```

3. Set env vars before starting the server:

   ```
   PAINTINGS_MOD_KEY=some-long-random-string   # unlocks the moderation endpoints
   PAINTINGS_SECRET=optional-shared-secret      # if set, uploads must match it
   ```

   - Without `PAINTINGS_MOD_KEY` the moderation endpoints stay **locked** (safe default).
   - `PAINTINGS_SECRET` is optional; if you set it, also set the same value on the
     in-game `PaintingWebConfig.sharedSecret` so uploads are accepted.

## Endpoints it adds

| Method | Path | Who |
|---|---|---|
| POST | `/api/paintings` | game — raw PNG body → `{ id }` |
| GET | `/paintings/:id.png` | anyone — serves the image (404 if hidden/gone) |
| GET | `/api/paintings` | **moderator** — list every painting incl. hidden |
| POST | `/api/paintings/:id/hide` · `/unhide` | **moderator** |
| DELETE | `/api/paintings/:id` | **moderator** |

Moderator requests send the key as the `X-Bark-Mod-Key` header (the moderation
page does this for you).

## Moderation page

`paintings.html` on this static site (**bark-vr.com/paintings**) is the moderator
gallery. Open it, enter the moderator key (= `PAINTINGS_MOD_KEY`), and it lists
every painting with the uploader's PlayFab id + date, with Hide / Delete buttons.
The page is `noindex` and isn't linked in the public nav.

## Storage

Images are `<dir>/<id>.png`; metadata is a single `<dir>/index.json`. No database.
`Hide` keeps the file but stops serving it to the game; `Delete` removes both.

## Note on hosting

Because this lives on the (rotating) Cloudflare-tunnel backend, painting images
only load while that backend is up — same trade-off as weather/wood-counts. If you
later want paintings to persist independently of the tunnel, point `dir` at a
folder synced to object storage (or commit it to a static host) — the game resolves
the backend base fresh each time, so the id-based URLs keep working.
