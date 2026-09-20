// pumpkin-mod.js — moderator page for carved pumpkins and the harvest festival.
//
// Two lists, because there are two different things a moderator might want to undo:
//
//   FESTIVAL   a pumpkin standing on a pedestal. Clearing the pedestal frees it in every lobby and
//              leaves the carve alone — the right move when something is merely in the way, or when
//              somebody parked a fine pumpkin somewhere silly.
//
//   PUMPKINS   the carve itself. HIDE stops the game and the site serving it at all, which also
//              drops it off its pedestal on the next read, and is reversible. DELETE destroys the
//              file and cannot be undone.
//
// Hide is offered first and delete needs a confirm, because "this is rude" and "this must never
// exist again" are different judgements and the reversible one should be the easy one.
//
// THE PUMPKINS ARE RENDERED, NOT LISTED AS IDS. A moderator has to see a carve to judge it, and
// pumpkins.js already rebuilds one from the same numbers the game uses — this page borrows that
// viewer rather than growing a second one that could disagree about what a pumpkin looks like.
//
// The moderator key lives in localStorage and travels as X-Bark-Mod-Key, exactly as the painting
// page does; the backend checks it against PAINTINGS_MOD_KEY. Unlisted page, noindex. 🍍

const PumpkinMod = (() => {
  let BACKEND = '';
  let showHidden = true;
  let pumpkins = [];
  let placements = [];
  const viewers = [];

  // ── THIS PAGE DRIVES ITS OWN VIEWERS ────────────────────────────────────────
  //
  // pumpkins.js only ticks the viewers IT created, from inside its own gallery
  // loop, and that loop does not run here — this page loads that file purely for
  // the builder. So the canvases would sit blank unless we animate them
  // ourselves. One shared WebGL context underneath either way.
  //
  // Off-screen cards are skipped, same as the gallery: a moderator scrolling past
  // sixty pumpkins should not be paying to draw all sixty every frame.
  let rafOn = false;
  let lastT = performance.now();

  const seenObserver = typeof IntersectionObserver === 'undefined' ? null
    : new IntersectionObserver((entries) => {
        for (const e of entries) {
          const v = viewers.find((x) => x.canvas === e.target);
          if (v) v.visible = e.isIntersecting;
        }
      }, { rootMargin: '150px' });

  function animate() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    for (const v of viewers) if (v.visible !== false) { try { v.tick(dt); } catch (e) {} }
    requestAnimationFrame(animate);
  }

  function startAnimating() {
    if (rafOn) return;
    rafOn = true;
    lastT = performance.now();
    requestAnimationFrame(animate);
  }

  const $ = (id) => document.getElementById(id);
  const status = (m) => { const e = $('modStatus'); if (e) e.textContent = m; };
  const key = () => ($('modKey') && $('modKey').value.trim()) || localStorage.getItem('barkModKey') || '';

  function saveKey() {
    const k = $('modKey') && $('modKey').value.trim();
    if (k) localStorage.setItem('barkModKey', k);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function loadBackendUrl() {
    if (BACKEND) return BACKEND;
    try {
      const r = await fetch('backend-url.json?t=' + Date.now());
      const j = await r.json();
      BACKEND = (j && j.backendUrl) || '';
    } catch (e) { BACKEND = ''; }
    return BACKEND;
  }

  async function load() {
    const k = key();
    if (!k) { status('Enter the moderator key first.'); return; }
    saveKey();
    status('Loading…');

    await loadBackendUrl();
    if (!BACKEND) { status('Backend offline (no backend-url.json).'); return; }

    try {
      const r = await fetch(`${BACKEND}/api/pumpkins`, { headers: { 'X-Bark-Mod-Key': k } });
      if (r.status === 401) { status('Wrong moderator key (or key not set on the backend).'); return; }
      const j = await r.json();
      pumpkins = j.pumpkins || [];
    } catch (e) { status('Could not load pumpkins: ' + e.message); return; }

    // The festival list is public — it is what the game reads — so it needs no key.
    try {
      const r = await fetch(`${BACKEND}/api/festival?t=${Date.now()}`);
      const j = await r.json();
      placements = j.placements || [];
    } catch (e) { placements = []; }

    renderFestival();
    await renderPumpkins();
    status(`${pumpkins.length} pumpkin(s) · ${pumpkins.filter((p) => p.hidden).length} hidden · ` +
           `${placements.length} on display`);
  }

  function toggleHidden() {
    showHidden = !showHidden;
    const b = $('toggleHiddenBtn');
    if (b) b.textContent = showHidden ? 'Showing: all' : 'Showing: visible only';
    renderPumpkins();
  }

  // ── FESTIVAL ────────────────────────────────────────────────────────────────

  function renderFestival() {
    const host = $('festivalList');
    if (!host) return;
    host.innerHTML = '';

    if (!placements.length) {
      host.innerHTML = '<p style="opacity:.7">Nothing is on display right now.</p>';
      return;
    }

    const rows = placements
      .slice()
      .sort((a, b) => (b.likes | 0) - (a.likes | 0))
      .map((f) => `
        <tr>
          <td><code>${escapeHtml(f.spotId)}</code></td>
          <td>${escapeHtml(f.artist || '—')}</td>
          <td><code>${escapeHtml(f.playfabId || '—')}</code></td>
          <td>${f.likes | 0}</td>
          <td><code>${escapeHtml((f.pumpkinId || '').slice(0, 10))}…</code></td>
          <td><button class="secondary" data-spot="${escapeHtml(f.spotId)}">Clear pedestal</button></td>
        </tr>`).join('');

    host.innerHTML = `
      <table style="width:100%;border-collapse:collapse" class="mod-table">
        <thead><tr style="text-align:left;opacity:.7">
          <th>Spot</th><th>Artist</th><th>Player</th><th>Likes</th><th>Carve</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    host.querySelectorAll('button[data-spot]').forEach((b) =>
      b.addEventListener('click', () => clearSpot(b.dataset.spot)));
  }

  async function clearSpot(spotId) {
    const k = key();
    if (!k) { status('Enter the moderator key first.'); return; }
    if (!confirm(`Clear pedestal "${spotId}"? The pumpkin comes off it in every lobby.`)) return;

    try {
      const r = await fetch(`${BACKEND}/api/festival/${encodeURIComponent(spotId)}`,
                            { method: 'DELETE', headers: { 'X-Bark-Mod-Key': k } });
      if (!r.ok) { status(`Clear failed (${r.status}).`); return; }
      placements = placements.filter((f) => f.spotId !== spotId);
      renderFestival();
      status(`cleared ${spotId} ✓`);
    } catch (e) { status('Clear failed: ' + e.message); }
  }

  // ── PUMPKINS ────────────────────────────────────────────────────────────────

  async function renderPumpkins() {
    const grid = $('pumpkinGrid');
    if (!grid) return;

    // Stop watching the old canvases and forget the old viewers. There is a single shared WebGL
    // context under all of them, so nothing here leaks a context - but a viewer whose canvas has
    // been removed from the DOM would keep being ticked forever.
    if (seenObserver) viewers.forEach((v) => { try { seenObserver.unobserve(v.canvas); } catch (e) {} });
    viewers.length = 0;
    grid.innerHTML = '';

    const list = showHidden ? pumpkins : pumpkins.filter((p) => !p.hidden);
    if (!list.length) { grid.innerHTML = '<p style="opacity:.7">Nothing to show.</p>'; return; }

    const onDisplay = new Set(placements.map((f) => f.pumpkinId));

    for (const p of list) {
      const when = new Date(p.createdAt).toLocaleString();
      const card = document.createElement('div');
      card.className = 'paint-card' + (p.hidden ? ' hidden' : '');
      card.innerHTML = `
        <canvas class="pump-canvas" style="width:100%;aspect-ratio:1;display:block"></canvas>
        <div class="paint-meta">
          ${p.hidden ? '<span class="paint-badge">HIDDEN</span><br>' : ''}
          ${onDisplay.has(p.id) ? '<span class="paint-badge">ON DISPLAY</span><br>' : ''}
          <b>Artist:</b> ${escapeHtml(p.artist || '—')}<br>
          <b>Player:</b> <code>${escapeHtml(p.playfabId || '—')}</code><br>
          <b>Likes:</b> ${p.likes | 0} &middot; <b>Strokes:</b> ${p.strokes | 0}<br>
          <b>When:</b> ${escapeHtml(when)}<br>
          <b>ID:</b> <code>${escapeHtml(p.id)}</code>
        </div>
        <div class="paint-actions">
          <button class="secondary" data-id="${p.id}" data-act="${p.hidden ? 'unhide' : 'hide'}">
            ${p.hidden ? 'Unhide' : 'Hide'}
          </button>
          <button data-id="${p.id}" data-act="delete">Delete</button>
        </div>`;
      grid.appendChild(card);

      // Render it. One fetch per carve, ~1.4 KB each.
      try {
        const cr = await fetch(`${BACKEND}/pumpkins/${p.id}.json`);
        if (cr.ok) {
          const carve = await cr.json();
          if (carve && carve.shape && window.PumpkinViewer) {
            const v = window.PumpkinViewer(card.querySelector('.pump-canvas'), carve);
            viewers.push(v);
            if (seenObserver) { v.visible = false; seenObserver.observe(v.canvas); }
            startAnimating();
          }
        } else {
          // A hidden pumpkin 404s from the public route on purpose — that is the whole point of
          // hiding. Say so rather than leaving a blank square that looks like a bug.
          card.querySelector('.pump-meta').innerHTML +=
            '<br><em>' + (p.hidden ? 'hidden — not served' : 'could not load') + '</em>';
        }
      } catch (e) {
        card.querySelector('.pump-meta').innerHTML += '<br><em>could not load</em>';
      }
    }

    grid.querySelectorAll('button[data-act]').forEach((b) =>
      b.addEventListener('click', () => act(b.dataset.id, b.dataset.act)));
  }

  async function act(id, action) {
    const k = key();
    if (!k) { status('Enter the moderator key first.'); return; }
    if (action === 'delete' &&
        !confirm('Permanently delete this pumpkin? It vanishes from every player\'s game and cannot be recovered.'))
      return;

    await loadBackendUrl();
    try {
      let r;
      if (action === 'delete') {
        r = await fetch(`${BACKEND}/api/pumpkins/${id}`, { method: 'DELETE', headers: { 'X-Bark-Mod-Key': k } });
      } else {
        r = await fetch(`${BACKEND}/api/pumpkins/${id}/${action}`, { method: 'POST', headers: { 'X-Bark-Mod-Key': k } });
      }
      if (!r.ok) { status(`Action failed (${r.status}).`); return; }

      if (action === 'delete') {
        pumpkins = pumpkins.filter((p) => p.id !== id);
      } else {
        const rec = pumpkins.find((p) => p.id === id);
        if (rec) rec.hidden = (action === 'hide');
      }
      // Either way the carve may have just left a pedestal, so the festival list is stale.
      placements = placements.filter((f) => f.pumpkinId !== id || action === 'unhide');

      renderFestival();
      await renderPumpkins();
      status(`${action} ✓ (${id.slice(0, 8)}…)`);
    } catch (e) {
      status('Action failed: ' + e.message);
    }
  }

  // Remember the key across visits, the same convenience the painting page has.
  document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('barkModKey');
    if (saved && $('modKey')) $('modKey').value = saved;
  });

  return { load, toggleHidden };
})();
