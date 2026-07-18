// paintings.js — moderator gallery for player whiteboard paintings.
//
// Loads every painting from the bark-manager backend (resolved from
// backend-url.json, same as the rest of the site), shows them in a grid with the
// uploader's PlayFab id + date, and lets a moderator HIDE (stops the game serving
// it) or DELETE (removes it) each one. The moderator key is kept in localStorage
// and sent as X-Bark-Mod-Key; the backend checks it against PAINTINGS_MOD_KEY.
//
// This page is unlisted (noindex) — moderators go to /paintings directly. 🍍

const Paintings = (() => {
  let BACKEND = '';
  let showHidden = true;   // true = show all, false = only unmoderated
  let cache = [];

  async function loadBackendUrl() {
    if (BACKEND) return BACKEND;
    try {
      const r = await fetch('backend-url.json?t=' + Date.now());
      const j = await r.json();
      if (j && j.backendUrl) BACKEND = String(j.backendUrl).replace(/\/$/, '');
    } catch (e) {
      console.warn('[paintings] backend-url.json failed:', e.message);
    }
    return BACKEND;
  }

  const $ = (id) => document.getElementById(id);
  const status = (msg) => { const s = $('modStatus'); if (s) s.textContent = msg; };
  const key = () => ($('modKey') ? $('modKey').value.trim() : '');

  function saveKey() { try { localStorage.setItem('bark_mod_key', key()); } catch {} }
  function restoreKey() {
    try { const k = localStorage.getItem('bark_mod_key'); if (k && $('modKey')) $('modKey').value = k; } catch {}
  }

  async function load() {
    const k = key();
    if (!k) { status('Enter the moderator key first.'); return; }
    saveKey();
    status('Loading…');
    await loadBackendUrl();
    if (!BACKEND) { status('Backend offline (no backend-url.json).'); return; }
    try {
      const r = await fetch(`${BACKEND}/api/paintings`, { headers: { 'X-Bark-Mod-Key': k } });
      if (r.status === 401) { status('Wrong moderator key (or key not set on the backend).'); return; }
      const j = await r.json();
      cache = j.paintings || [];
      render();
      status(`${cache.length} painting(s) · ${cache.filter(p => p.hidden).length} hidden`);
    } catch (e) {
      status('Load failed: ' + e.message);
    }
  }

  function toggleHidden() {
    showHidden = !showHidden;
    const b = $('toggleHiddenBtn');
    if (b) b.textContent = showHidden ? 'Showing: all' : 'Showing: visible only';
    render();
  }

  function render() {
    const grid = $('paintGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const list = showHidden ? cache : cache.filter(p => !p.hidden);
    if (!list.length) { grid.innerHTML = '<p style="opacity:.7">Nothing to show.</p>'; return; }

    for (const p of list) {
      const when = new Date(p.createdAt).toLocaleString();
      const versions = p.versions || 1;
      // Past versions: current is <id>.png; older ones archived as <id>.v1.png .. v(N-1).
      let history = '';
      if (versions > 1) {
        const links = [];
        for (let v = versions - 1; v >= 1; v--)
          links.push(`<a href="${BACKEND}/paintings/${p.id}.v${v}.png" target="_blank" rel="noopener">v${v}</a>`);
        history = `<br><b>History:</b> ${links.join(' ')}`;
      }
      const card = document.createElement('div');
      card.className = 'paint-card' + (p.hidden ? ' hidden' : '');
      card.innerHTML = `
        <img class="paint-img" loading="lazy" src="${BACKEND}/paintings/${p.id}.png?t=${Date.now()}"
             alt="painting" onerror="this.style.opacity=.2" />
        <div class="paint-meta">
          ${p.hidden ? '<span class="paint-badge">HIDDEN</span><br>' : ''}
          ${p.artist ? `<b>Artist:</b> ${escapeHtml(p.artist)}<br>` : ''}
          <b>Player:</b> ${escapeHtml(p.playfabId || '—')}<br>
          <b>When:</b> ${escapeHtml(when)}
          ${versions > 1 ? ` &middot; <b>v${versions}</b>` : ''}${history}<br>
          <b>ID:</b> ${escapeHtml(p.id)}
        </div>
        <div class="paint-actions">
          <button class="btn-hide" data-id="${p.id}" data-act="${p.hidden ? 'unhide' : 'hide'}">
            ${p.hidden ? 'Unhide' : 'Hide'}
          </button>
          <button class="btn-del" data-id="${p.id}" data-act="delete">Delete</button>
        </div>`;
      grid.appendChild(card);
    }
    grid.querySelectorAll('button[data-act]').forEach((b) =>
      b.addEventListener('click', () => act(b.dataset.id, b.dataset.act)));
  }

  async function act(id, action) {
    const k = key();
    if (!k) { status('Enter the moderator key first.'); return; }
    if (action === 'delete' && !confirm('Permanently delete this painting? It vanishes from every player\'s game.')) return;
    await loadBackendUrl();
    try {
      let r;
      if (action === 'delete') {
        r = await fetch(`${BACKEND}/api/paintings/${id}`, { method: 'DELETE', headers: { 'X-Bark-Mod-Key': k } });
      } else {
        r = await fetch(`${BACKEND}/api/paintings/${id}/${action}`, { method: 'POST', headers: { 'X-Bark-Mod-Key': k } });
      }
      if (!r.ok) { status(`Action failed (${r.status}).`); return; }
      // Update local cache without a full reload.
      if (action === 'delete') cache = cache.filter(p => p.id !== id);
      else { const rec = cache.find(p => p.id === id); if (rec) rec.hidden = (action === 'hide'); }
      render();
      status(`${action} ✓ (${id.slice(0, 8)}…)`);
    } catch (e) {
      status('Action failed: ' + e.message);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  document.addEventListener('DOMContentLoaded', restoreKey);

  return { load, toggleHidden };
})();
