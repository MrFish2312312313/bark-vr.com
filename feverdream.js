// FEVERDREAM worlds page (/feverdream). Reads the game's PlayFab title (19852) through its read-only CloudScript
// handlers - Site_ListWorlds, Site_GetWorld, Site_WorldPhotos (Wicklings repo: Server/feverdream_cloudscript.js).
// Private worlds never come back from them. Like the dev page, we log in with a throwaway per-browser CustomId just
// to be allowed to call ExecuteCloudScript; no secret key is ever in the page. 🍍
(function () {
  const TITLE = '19852';
  const statusEl = document.getElementById('fdStatus');
  const view = document.getElementById('fdView');
  let session = null;

  function customId() {
    let id = null;
    try { id = localStorage.getItem('fd.pfSiteCustomId'); } catch (e) { }
    if (!id) {
      id = 'fdsite_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem('fd.pfSiteCustomId', id); } catch (e) { }
    }
    return id;
  }

  async function login() {
    if (session) return session;
    const res = await fetch(`https://${TITLE}.playfabapi.com/Client/LoginWithCustomID`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ TitleId: TITLE, CustomId: customId(), CreateAccount: true }),
    });
    const j = await res.json();
    if (j.code !== 200 || !j.data || !j.data.SessionTicket) throw new Error('PlayFab login failed: ' + (j.errorMessage || j.code));
    session = j.data.SessionTicket;
    return session;
  }

  async function cs(fn, args) {
    const ticket = await login();
    const res = await fetch(`https://${TITLE}.playfabapi.com/Client/ExecuteCloudScript`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Authorization': ticket },
      body: JSON.stringify({ FunctionName: fn, FunctionParameter: args || {}, GeneratePlayStreamEvent: false }),
    });
    const j = await res.json();
    if (j.code !== 200) throw new Error(fn + ': ' + (j.errorMessage || j.code));
    if (j.data && j.data.Error) throw new Error(fn + ': ' + (j.data.Error.Message || j.data.Error.Error));
    return (j.data && j.data.FunctionResult) || {};
  }

  // ── helpers ───────────────────────────────────────────────────────────
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  function ago(t) {
    if (!t) return '';
    const s = Date.now() / 1000 - t;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' days ago';
  }

  // A builder's save text (WorldShard in the game): "1|uid|rev", then p|id,type,x,z,y,side,mat,paint,contents lines.
  function parseShard(text) {
    const pieces = [];
    for (const line of String(text || '').split('\n')) {
      if (!line.startsWith('p|')) continue;
      const f = line.slice(2).split(',');
      if (f.length < 8) continue;
      pieces.push({ type: +f[1], x: +f[2], z: +f[3], y: +f[4], side: +f[5], mat: +f[6], paint: +f[7] });
    }
    return pieces;
  }
  function shardsToBuilders(shards) {
    const byBuilder = {};
    Object.keys(shards || {}).sort().forEach(k => {
      const m = /^s_(.+)_(\d+)$/.exec(k);
      if (!m) return;
      (byBuilder[m[1]] = byBuilder[m[1]] || []).push([+m[2], shards[k]]);
    });
    return Object.values(byBuilder).map(chunks => parseShard(chunks.sort((a, b) => a[0] - b[0]).map(c => c[1]).join('')));
  }

  // ── map ──────────────────────────────────────────────────────────────
  // BuildDefs: PieceType order + material colours (wood / stone / brick / packed earth)
  const EDGE = new Set([1, 2, 3, 14, 16]);              // Wall, Doorway, Window, Door, Fence: on a cell edge
  const MAT = ['#8c5e40', '#9996a8', '#b85442', '#8c6947'];
  const PROP = { 6: '#ff9a3c', 7: '#ffd479', 8: '#c9a46a', 9: '#c9a46a', 10: '#ff6a3c', 11: '#ff9a3c', 12: '#7fb0ff', 13: '#d8b35a', 15: '#7bbf6a' };
  function pieceColor(p) {
    if (p.paint && (p.paint & (1 << 24))) {
      const v = p.paint & 0xffffff;
      return `rgb(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255})`;
    }
    return PROP[p.type] || MAT[p.mat] || MAT[0];
  }

  // Bases sit far apart on an endless map: group pieces into clusters and draw the biggest few.
  function clusters(pieces) {
    const cell = 24, groups = {};
    for (const p of pieces) {
      const k = Math.floor(p.x / cell) + ',' + Math.floor(p.z / cell);
      (groups[k] = groups[k] || []).push(p);
    }
    // merge neighbouring buckets so one base split by a bucket line stays one
    const keys = Object.keys(groups), seen = new Set(), out = [];
    for (const k of keys) {
      if (seen.has(k)) continue;
      const stack = [k], list = [];
      seen.add(k);
      while (stack.length) {
        const c = stack.pop(); list.push(...groups[c]);
        const [cx, cz] = c.split(',').map(Number);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          const n = (cx + dx) + ',' + (cz + dz);
          if (groups[n] && !seen.has(n)) { seen.add(n); stack.push(n); }
        }
      }
      out.push(list);
    }
    return out.sort((a, b) => b.length - a.length);
  }

  function drawCluster(canvas, list) {
    const px = 2 * (window.devicePixelRatio || 1);
    canvas.width = canvas.height = 300 * px / 2;
    const g = canvas.getContext('2d');
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of list) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x + 1); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z + 1); }
    const span = Math.max(x1 - x0, z1 - z0, 6) + 2;
    const s = canvas.width / span;
    const ox = (canvas.width - (x1 - x0) * s) / 2, oz = (canvas.height - (z1 - z0) * s) / 2;
    const X = x => ox + (x - x0) * s, Z = z => canvas.height - (oz + (z - z0) * s); // +z up, like a map
    // grid
    g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1;
    for (let i = Math.floor(x0 - span); i <= x1 + span; i++) { g.beginPath(); g.moveTo(X(i), 0); g.lineTo(X(i), canvas.height); g.stroke(); }
    for (let i = Math.floor(z0 - span); i <= z1 + span; i++) { g.beginPath(); g.moveTo(0, Z(i)); g.lineTo(canvas.width, Z(i)); g.stroke(); }
    // floors first (lowest first, so upper floors draw over), then props, then edges
    const floors = list.filter(p => p.type === 0 || p.type === 4 || p.type === 5).sort((a, b) => a.y - b.y);
    for (const p of floors) {
      g.fillStyle = pieceColor(p); g.globalAlpha = p.type === 4 ? 0.55 : 0.9;
      g.fillRect(X(p.x) + 0.5, Z(p.z + 1) + 0.5, s - 1, s - 1);
    }
    g.globalAlpha = 1;
    for (const p of list) {
      if (!PROP[p.type]) continue;
      g.fillStyle = pieceColor(p);
      g.beginPath(); g.arc(X(p.x + 0.5), Z(p.z + 0.5), Math.max(2, s * 0.18), 0, Math.PI * 2); g.fill();
    }
    g.lineCap = 'round';
    for (const p of list) {
      if (!EDGE.has(p.type)) continue;
      g.strokeStyle = pieceColor(p); g.lineWidth = Math.max(2, s * (p.type === 16 ? 0.08 : 0.16));
      g.setLineDash(p.type === 3 ? [s * 0.25, s * 0.15] : p.type === 2 || p.type === 14 ? [s * 0.3, s * 0.4] : []);
      g.beginPath();
      if (p.side === 0) { g.moveTo(X(p.x), Z(p.z + 1)); g.lineTo(X(p.x + 1), Z(p.z + 1)); }
      else { g.moveTo(X(p.x + 1), Z(p.z)); g.lineTo(X(p.x + 1), Z(p.z + 1)); }
      g.stroke();
    }
    g.setLineDash([]);
  }

  // ── views ────────────────────────────────────────────────────────────
  async function showList() {
    statusEl.textContent = 'Finding public dreams…';
    view.innerHTML = '';
    const r = await cs('Site_ListWorlds');
    const worlds = (r.worlds || []).slice(0, 48);
    if (!worlds.length) { statusEl.textContent = 'No public worlds yet.'; return; }
    statusEl.textContent = worlds.length + ' public world' + (worlds.length === 1 ? '' : 's');
    const grid = el('div', 'fd-grid');
    view.appendChild(grid);
    for (const w of worlds) {
      const card = el('button', 'fd-card');
      card.type = 'button';
      card.innerHTML = `<div class="fd-thumbs"><div class="fd-none">…</div></div>
        <div class="fd-card-body"><h3>${esc(w.name)}</h3><div class="fd-meta">code ${esc(w.code)} · made ${esc(ago(w.created))}</div></div>`;
      card.addEventListener('click', () => go(w.code));
      grid.appendChild(card);
      // three photo thumbnails per card, loaded after the list is up
      cs('Site_WorldPhotos', { code: w.code }).then(p => {
        const thumbs = card.querySelector('.fd-thumbs');
        const photos = (p.photos || []).slice(0, 3);
        thumbs.innerHTML = photos.length ? photos.map(ph => `<img loading="lazy" src="${esc(ph.url)}" alt="${esc(ph.name)}">`).join('')
          : '<div class="fd-none">no shared photos yet</div>';
      }).catch(() => { card.querySelector('.fd-thumbs').innerHTML = '<div class="fd-none">photos unavailable</div>'; });
    }
  }

  async function showWorld(code) {
    statusEl.textContent = 'Opening world ' + code + '…';
    view.innerHTML = '';
    const [w, p] = await Promise.all([cs('Site_GetWorld', { code }), cs('Site_WorldPhotos', { code }).catch(() => ({ photos: [] }))]);
    if (!w.ok) { statusEl.textContent = w.error === 'not found' ? 'No public world has the code ' + code + '.' : 'Couldn\'t open it: ' + w.error; addBack(); return; }
    statusEl.textContent = '';
    const builders = shardsToBuilders(w.shards);
    const all = builders.flat();
    const wrap = el('div', 'fd-world');
    wrap.appendChild(backButton());
    wrap.appendChild(el('h2', null, esc(w.name)));
    wrap.appendChild(el('p', 'fd-sub', `code <b>${esc(w.code)}</b> · ${builders.length} builder${builders.length === 1 ? '' : 's'} · ${all.length} piece${all.length === 1 ? '' : 's'} · made ${esc(ago(w.created))}`));

    wrap.appendChild(el('div', 'fd-h', 'WHAT WAS BUILT'));
    if (!all.length) wrap.appendChild(el('p', 'fd-empty', 'Nothing built here yet.'));
    else {
      const maps = el('div', 'fd-maps');
      clusters(all).slice(0, 6).forEach((list, i) => {
        const box = el('div', 'fd-map');
        const c = document.createElement('canvas');
        box.appendChild(c);
        box.appendChild(el('p', null, `${i === 0 ? 'biggest base' : 'base ' + (i + 1)} · ${list.length} pieces`));
        maps.appendChild(box);
        requestAnimationFrame(() => drawCluster(c, list));
      });
      wrap.appendChild(maps);
    }

    wrap.appendChild(el('div', 'fd-h', 'SPECIES PHOTOGRAPHED'));
    const photos = p.photos || [];
    if (!photos.length) wrap.appendChild(el('p', 'fd-empty', 'No shared photos yet.'));
    else {
      const grid = el('div', 'fd-photos');
      for (const ph of photos)
        grid.appendChild(el('figure', 'fd-photo', `<img loading="lazy" src="${esc(ph.url)}" alt="${esc(ph.name)}"><figcaption>${esc(ph.name || 'an unnamed species')}<span>${esc(ago(ph.time))}</span></figcaption>`));
      wrap.appendChild(grid);
    }
    view.appendChild(wrap);
  }

  function backButton() {
    const b = el('button', 'fd-back', '← ALL WORLDS');
    b.type = 'button';
    b.addEventListener('click', () => go(null));
    return b;
  }
  function addBack() { view.appendChild(backButton()); }

  function go(code) {
    const url = new URL(location.href);
    if (code) url.searchParams.set('world', code); else url.searchParams.delete('world');
    history.pushState(null, '', url);
    route();
  }

  function route() {
    const code = new URLSearchParams(location.search).get('world');
    const task = code && /^[1-9]\d{5}$/.test(code) ? showWorld(code) : showList();
    task.catch(e => { statusEl.textContent = 'The dream server isn\'t answering right now (' + e.message + ').'; });
    window.scrollTo(0, 0);
  }

  document.getElementById('fdCodeForm').addEventListener('submit', e => {
    e.preventDefault();
    const code = document.getElementById('fdCode').value.replace(/\D/g, '');
    if (/^[1-9]\d{5}$/.test(code)) go(code);
    else statusEl.textContent = 'A world code is six numbers.';
  });
  window.addEventListener('popstate', route);
  route();
})();
