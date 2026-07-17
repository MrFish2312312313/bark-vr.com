// paintings.js — Bark whiteboard-painting storage + moderation, for the
// bark-manager backend (the Node/Express server behind the Cloudflare tunnel).
//
// THIS FILE RUNS ON THE BACKEND, not on the static bark-vr.com site. Copy it into
// bark-manager and mount it once:
//
//     const mountPaintings = require('./paintings');
//     mountPaintings(app, { dir: __dirname + '/paintings' });
//
// Endpoints it adds:
//   POST   /api/paintings              upload a PNG (raw body, image/png) → { id }
//   GET    /paintings/:id.png          serve the image (404 if missing/hidden)
//   GET    /api/paintings              MOD: list every painting (incl. hidden)
//   POST   /api/paintings/:id/hide     MOD: hide (still stored, stops serving)
//   POST   /api/paintings/:id/unhide   MOD: unhide
//   DELETE /api/paintings/:id          MOD: delete image + record
//
// Env vars:
//   PAINTINGS_MOD_KEY   required for the MOD endpoints (moderation page sends it)
//   PAINTINGS_SECRET    optional — if set, uploads must send matching X-Bark-Secret
//
// Storage: images as <dir>/<id>.png, metadata in <dir>/index.json. No database
// needed. 🍍

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function mountPaintings(app, opts = {}) {
  const DIR = opts.dir || path.join(__dirname, 'paintings');
  const INDEX = path.join(DIR, 'index.json');
  const MOD_KEY = process.env.PAINTINGS_MOD_KEY || opts.modKey || '';
  const UPLOAD_SECRET = process.env.PAINTINGS_SECRET || opts.secret || '';
  const MAX_BYTES = opts.maxBytes || 5 * 1024 * 1024;   // 5 MB per image

  fs.mkdirSync(DIR, { recursive: true });

  // ── tiny JSON index (loaded once, written on change) ──
  let index = [];
  try { index = JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch { index = []; }
  if (!Array.isArray(index)) index = [];
  const saveIndex = () => {
    try { fs.writeFileSync(INDEX, JSON.stringify(index)); }
    catch (e) { console.error('[paintings] index write failed:', e.message); }
  };
  const find = (id) => index.find((p) => p && p.id === id);

  // ── CORS so the static bark-vr.com moderation page can call us ──
  const cors = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Playfab-Id, X-Bark-Secret, X-Bark-Mod-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  };
  app.options('/api/paintings', (req, res) => { cors(res); res.sendStatus(204); });
  app.options('/api/paintings/:id', (req, res) => { cors(res); res.sendStatus(204); });
  app.options('/api/paintings/:id/hide', (req, res) => { cors(res); res.sendStatus(204); });
  app.options('/api/paintings/:id/unhide', (req, res) => { cors(res); res.sendStatus(204); });

  const modOk = (req) => {
    if (!MOD_KEY) return false;   // no key configured → moderation is locked, not open
    const k = req.get('X-Bark-Mod-Key') || req.query.key || '';
    return k === MOD_KEY;
  };
  const safeId = (id) => /^[a-f0-9]{8,64}$/i.test(id);

  // ── Upload (the game POSTs the raw PNG) ──
  app.post('/api/paintings',
    require('express').raw({ type: ['image/png', 'application/octet-stream'], limit: MAX_BYTES }),
    (req, res) => {
      cors(res);
      if (UPLOAD_SECRET && req.get('X-Bark-Secret') !== UPLOAD_SECRET)
        return res.status(403).json({ error: 'bad secret' });

      const buf = req.body;
      if (!buf || !buf.length) return res.status(400).json({ error: 'empty' });
      // PNG magic bytes — reject anything that isn't actually a PNG.
      if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47))
        return res.status(400).json({ error: 'not a png' });

      const id = crypto.randomBytes(16).toString('hex');
      try { fs.writeFileSync(path.join(DIR, id + '.png'), buf); }
      catch (e) { console.error('[paintings] write failed:', e.message); return res.status(500).json({ error: 'store failed' }); }

      index.push({
        id,
        playfabId: (req.get('X-Playfab-Id') || '').slice(0, 64),
        createdAt: Date.now(),
        bytes: buf.length,
        hidden: false,
      });
      saveIndex();
      res.json({ id });
    });

  // ── Serve an image ──
  app.get('/paintings/:id.png', (req, res) => {
    const id = req.params.id;
    if (!safeId(id)) return res.sendStatus(404);
    const rec = find(id);
    if (rec && rec.hidden) return res.sendStatus(404);   // moderated → gone from the game
    const file = path.join(DIR, id + '.png');
    if (!fs.existsSync(file)) return res.sendStatus(404);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(file).pipe(res);
  });

  // ── Moderation: list all (incl. hidden) ──
  app.get('/api/paintings', (req, res) => {
    cors(res);
    if (!modOk(req)) return res.status(401).json({ error: 'unauthorized' });
    const list = [...index].sort((a, b) => b.createdAt - a.createdAt);
    res.json({ paintings: list });
  });

  // ── Moderation: hide / unhide / delete ──
  const setHidden = (req, res, hidden) => {
    cors(res);
    if (!modOk(req)) return res.status(401).json({ error: 'unauthorized' });
    const rec = find(req.params.id);
    if (!rec) return res.status(404).json({ error: 'not found' });
    rec.hidden = hidden;
    saveIndex();
    res.json({ ok: true, id: rec.id, hidden });
  };
  app.post('/api/paintings/:id/hide',   (req, res) => setHidden(req, res, true));
  app.post('/api/paintings/:id/unhide', (req, res) => setHidden(req, res, false));

  app.delete('/api/paintings/:id', (req, res) => {
    cors(res);
    if (!modOk(req)) return res.status(401).json({ error: 'unauthorized' });
    const id = req.params.id;
    if (!safeId(id)) return res.status(400).json({ error: 'bad id' });
    try { fs.unlinkSync(path.join(DIR, id + '.png')); } catch { /* already gone */ }
    index = index.filter((p) => p.id !== id);
    saveIndex();
    res.json({ ok: true, deleted: id });
  });

  console.log('[paintings] mounted (mod endpoints ' + (MOD_KEY ? 'ENABLED' : 'LOCKED — set PAINTINGS_MOD_KEY') + ').');
};
