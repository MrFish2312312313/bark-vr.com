// creations.js — bark-vr.com/creations: everything players have made in BARK, for everyone.
//
// Two tabs:
//   PUMPKINS   carved pumpkins, rebuilt in 3D from the cuts (the viewer lives in pumpkins.js and
//              is shared with the moderation page). Only open while the game's season is AUTUMN -
//              the backend's /season/current says which real season the in-game one belongs to -
//              so the patch opens the moment the festival does. Moderators see it all year.
//   PAINTINGS  whiteboard paintings printed in-game.
//
// PAGED, ten pumpkins a page. Every pumpkin card rebuilds a full carve mesh in the browser, and
// building sixty at once is what made the old gallery sit blank for so long. The backend pages the
// public feeds (?limit&offset -> total); an older backend without paging still works, sliced here.
//
// MODERATION is on the same page. Anyone can look; hiding and deleting need the moderator key,
// which the backend checks (X-Bark-Mod-Key vs PAINTINGS_MOD_KEY) - the page only decides which
// buttons to draw. Unlocked, both tabs list HIDDEN items too, from the moderator endpoints. 🍍

const Creations = (() => {
  const PER_PAGE = { pumpkins: 10, paintings: 12 };
  const KEY_STORES = ['bark_mod_key', 'barkModKey'];   // the two old moderation pages' names

  let BACKEND = '';
  let tab = null;
  let page = 1;
  let autumn = false;
  let modKey = '';                                   // only ever set once the backend accepted it
  const modLists = { pumpkins: null, paintings: null };
  const legacy = { pumpkins: null };                 // whole public list, if the backend cannot page
  let loadToken = 0;
  let lit = false;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const status = (m) => { const e = $('crStatus'); if (e) e.textContent = m; };
  const modStatus = (m) => { const e = $('crModStatus'); if (e) e.textContent = m; };
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  function storage(get, k, v) {
    try { return get ? localStorage.getItem(k) : (v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v)); }
    catch (e) { return null; }
  }

  async function resolveBackend() {
    if (BACKEND) return BACKEND;
    try {
      const r = await fetch('backend-url.json?t=' + Date.now());
      const j = await r.json();
      if (j && j.backendUrl) BACKEND = String(j.backendUrl).replace(/\/$/, '');
    } catch (e) { console.warn('[creations] backend-url.json failed:', e.message); }
    return BACKEND;
  }

  // ── Season: is the pumpkin patch open? ────────────────────────────────────────────────────────

  async function checkSeason() {
    try {
      const r = await fetch(`${BACKEND}/season/current?t=${Date.now()}`);
      const j = await r.json();
      const name = (j && j.season && j.season.displayName) || '';
      // `group` is the real season the backend maps the in-game one to; the name test covers a
      // backend that predates it (Autumn and Deadleaf are the two autumn phases).
      autumn = (j && j.group === 'autumn') || /autumn|deadleaf|harvest|halloween|\bfall\b/i.test(name);
    } catch (e) { autumn = false; }
  }

  function pumpkinsOpen() { return autumn || !!modKey; }

  // ── Viewers (pumpkins) ────────────────────────────────────────────────────────────────────────

  const viewers = [];
  const seen = typeof IntersectionObserver === 'undefined' ? null
    : new IntersectionObserver((entries) => {
        for (const e of entries) {
          const v = viewers.find((x) => x.canvas === e.target);
          if (v) v.visible = e.isIntersecting;
        }
      }, { rootMargin: '150px' });

  let rafOn = false, lastT = 0;
  function animate() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    for (const v of viewers) if (v.visible !== false) { try { v.tick(dt); } catch (e) {} }
    requestAnimationFrame(animate);
  }
  function startAnimating() {
    if (rafOn) return;
    rafOn = true; lastT = performance.now();
    requestAnimationFrame(animate);
  }

  function dropViewers() {
    for (const v of viewers) {
      if (seen) { try { seen.unobserve(v.canvas); } catch (e) {} }
      if (v.dispose) { try { v.dispose(); } catch (e) {} }
    }
    viewers.length = 0;
  }

  // ── Fetching a page ───────────────────────────────────────────────────────────────────────────

  /// { items, total } for the current tab and page - from the moderator list when unlocked
  /// (hidden ones included), otherwise from the public paged feed.
  async function fetchPage(which, pg) {
    const per = PER_PAGE[which];
    const offset = (pg - 1) * per;

    if (modKey && modLists[which]) {
      const all = modLists[which];
      return { items: all.slice(offset, offset + per), total: all.length };
    }

    if (which === 'pumpkins') {
      if (legacy.pumpkins) return { items: legacy.pumpkins.slice(offset, offset + per), total: legacy.pumpkins.length };
      const r = await fetch(`${BACKEND}/api/pumpkins/public?limit=${per}&offset=${offset}`);
      const j = await r.json();
      if (typeof j.total === 'number') return { items: j.pumpkins || [], total: j.total };
      // An older backend ignores offset and has no total: take the whole list once and page it here.
      const all = await (await fetch(`${BACKEND}/api/pumpkins/public?limit=200`)).json();
      legacy.pumpkins = all.pumpkins || [];
      return { items: legacy.pumpkins.slice(offset, offset + per), total: legacy.pumpkins.length };
    }

    const r = await fetch(`${BACKEND}/api/paintings/public?limit=${per}&offset=${offset}`);
    if (r.status === 404) throw new Error('offline');       // backend not restarted onto the public feed yet
    const j = await r.json();
    return { items: j.paintings || [], total: j.total | 0 };
  }

  // ── Rendering ─────────────────────────────────────────────────────────────────────────────────

  async function render() {
    const token = ++loadToken;
    const grid = $('crGrid');
    dropViewers();
    grid.innerHTML = '';
    setTabs();

    const lights = $('crLights');
    lights.hidden = tab !== 'pumpkins';
    $('crNote').textContent = tab === 'pumpkins'
      ? 'Every pumpkin here is rebuilt from the cuts that were actually made to it - the shape it grew with, and every point placed with the knife and the scraper. Drag any of them around to see the inside.'
      : 'Painted on whiteboards in BARK and printed in-game.';

    status('Loading…');
    let res;
    try { res = await fetchPage(tab, page); }
    catch (e) {
      if (token !== loadToken) return;
      status(tab === 'paintings' && e.message === 'offline'
        ? 'The paintings gallery is not online yet - check back soon.'
        : 'Could not reach the gallery: ' + e.message);
      pager(0);
      return;
    }
    if (token !== loadToken) return;

    const per = PER_PAGE[tab];
    const pages = Math.max(1, Math.ceil(res.total / per));
    if (page > pages && res.total > 0) { page = pages; updateUrl(); return render(); }
    pager(pages);

    const noun = tab === 'pumpkins' ? 'pumpkin' : 'painting';
    if (!res.total) { status(`No ${noun}s yet.`); return; }
    let line = `${res.total} ${noun}${res.total === 1 ? '' : 's'}`;
    if (pages > 1) line += ` · page ${page} of ${pages}`;
    if (modKey && modLists[tab]) line += ` · ${modLists[tab].filter((x) => x.hidden).length} hidden`;
    status(line);

    if (tab === 'pumpkins') await renderPumpkins(res.items, token);
    else renderPaintings(res.items);
  }

  function modBlock(rec) {
    if (!modKey) return '';
    return `
      <div class="cr-actions">
        <button class="cr-hide" data-id="${esc(rec.id)}" data-act="${rec.hidden ? 'unhide' : 'hide'}">${rec.hidden ? 'Unhide' : 'Hide'}</button>
        <button class="cr-del" data-id="${esc(rec.id)}" data-act="delete">Delete</button>
      </div>`;
  }

  function modMeta(rec) {
    if (!modKey) return '';
    return `<br><b>Player:</b> <code>${esc(rec.playfabId || '—')}</code><br><b>ID:</b> <code>${esc(rec.id)}</code>`;
  }

  async function renderPumpkins(items, token) {
    const grid = $('crGrid');
    const cards = items.map((rec) => {
      const card = document.createElement('div');
      card.className = 'cr-card' + (rec.hidden ? ' is-hidden' : '');
      const likes = rec.likes | 0;
      card.innerHTML =
        `<canvas class="cr-canvas"></canvas>` +
        `<div class="cr-meta">${rec.hidden ? '<span class="cr-badge">HIDDEN</span><br>' : ''}` +
        `<strong>${esc(rec.artist || 'Someone')}</strong><br>` +
        `${rec.strokes | 0} cut${(rec.strokes | 0) === 1 ? '' : 's'} · ` +
        `${esc(new Date(rec.createdAt || Date.now()).toLocaleDateString())}` +
        `${likes > 0 ? ` · ♥ ${likes}` : ''}${modMeta(rec)}</div>` + modBlock(rec);
      grid.appendChild(card);
      return card;
    });
    wireActions();

    // All ten carves in parallel (~1.4 KB each), then built one per frame so the page keeps
    // responding while the meshes go up.
    const carves = await Promise.all(items.map((rec) =>
      fetch(`${BACKEND}/pumpkins/${rec.id}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
    if (token !== loadToken) return;

    for (let i = 0; i < items.length; i++) {
      const carve = carves[i];
      if (!carve || !carve.shape || !window.PumpkinViewer) {
        cards[i].querySelector('.cr-meta').innerHTML +=
          '<br><em>' + (items[i].hidden ? 'hidden - not served' : 'could not load') + '</em>';
        continue;
      }
      await nextFrame();
      if (token !== loadToken) return;
      try {
        const v = window.PumpkinViewer(cards[i].querySelector('.cr-canvas'), carve);
        v.setLit(lit);
        viewers.push(v);
        if (seen) { v.visible = false; seen.observe(v.canvas); }
        startAnimating();
      } catch (e) {
        cards[i].querySelector('.cr-meta').innerHTML += '<br><em>could not load</em>';
      }
    }
  }

  function renderPaintings(items) {
    const grid = $('crGrid');
    for (const rec of items) {
      const card = document.createElement('div');
      card.className = 'cr-card' + (rec.hidden ? ' is-hidden' : '');
      // ?v= because an edited painting keeps its id and the image is cached for a day.
      const src = `${BACKEND}/paintings/${encodeURIComponent(rec.id)}.png?v=${rec.versions || 1}`;
      card.innerHTML =
        `<a href="${src}" target="_blank" rel="noopener"><img class="cr-img" loading="lazy" src="${src}" alt="Painting by ${esc(rec.artist || 'someone')}" /></a>` +
        `<div class="cr-meta">${rec.hidden ? '<span class="cr-badge">HIDDEN</span><br>' : ''}` +
        `<strong>${esc(rec.artist || 'Someone')}</strong><br>` +
        `${esc(new Date(rec.createdAt || Date.now()).toLocaleDateString())}` +
        `${(rec.versions | 0) > 1 ? ` · v${rec.versions | 0}` : ''}${modMeta(rec)}</div>` + modBlock(rec);
      const img = card.querySelector('img');
      img.addEventListener('error', () => {
        img.style.opacity = '.2';
        if (rec.hidden) card.querySelector('.cr-meta').innerHTML += '<br><em>hidden - not served</em>';
      });
      grid.appendChild(card);
    }
    wireActions();
  }

  // ── Tabs, pages, URL ──────────────────────────────────────────────────────────────────────────

  function setTabs() {
    const pt = $('tab-pumpkins');
    pt.hidden = !pumpkinsOpen();
    for (const b of document.querySelectorAll('.cr-tab'))
      b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
  }

  function updateUrl() {
    const q = new URLSearchParams(location.search);
    q.set('tab', tab);
    if (page > 1) q.set('page', String(page)); else q.delete('page');
    history.replaceState(null, '', location.pathname + '?' + q.toString());
  }

  function go(newTab, newPage) {
    tab = newTab; page = newPage;
    updateUrl();
    render();
  }

  function pager(pages) {
    for (const id of ['crPagerTop', 'crPagerBottom']) {
      const host = $(id);
      host.innerHTML = '';
      host.hidden = pages <= 1;
      if (pages <= 1) continue;

      const btn = (label, target, opts) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        if (opts && opts.current) b.setAttribute('aria-current', 'page');
        if (opts && opts.disabled) b.disabled = true;
        if (opts && opts.aria) b.setAttribute('aria-label', opts.aria);
        b.addEventListener('click', () => {
          go(tab, target);
          if (id === 'crPagerBottom') $('crGrid').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        host.appendChild(b);
      };
      const gap = () => { const s = document.createElement('span'); s.className = 'gap'; s.textContent = '…'; host.appendChild(s); };

      btn('‹', page - 1, { disabled: page <= 1, aria: 'Previous page' });
      const show = new Set([1, pages, page - 1, page, page + 1]);
      let prev = 0;
      for (let p = 1; p <= pages; p++) {
        if (!show.has(p)) continue;
        if (p - prev > 1) gap();
        btn(String(p), p, { current: p === page });
        prev = p;
      }
      btn('›', page + 1, { disabled: page >= pages, aria: 'Next page' });
    }
  }

  // ── Moderation ────────────────────────────────────────────────────────────────────────────────

  async function fetchModLists(k) {
    const r = await fetch(`${BACKEND}/api/pumpkins`, { headers: { 'X-Bark-Mod-Key': k } });
    if (r.status === 401) return false;
    modLists.pumpkins = ((await r.json()).pumpkins) || [];
    try {
      const p = await fetch(`${BACKEND}/api/paintings`, { headers: { 'X-Bark-Mod-Key': k } });
      modLists.paintings = p.ok ? ((await p.json()).paintings || []) : null;
    } catch (e) { modLists.paintings = null; }
    return true;
  }

  async function unlock(k, quiet) {
    if (!k) { modStatus('Enter the moderator key first.'); return; }
    modStatus('Checking…');
    let ok = false;
    try { ok = await fetchModLists(k); }
    catch (e) { modStatus('Could not reach the backend: ' + e.message); return; }
    if (!ok) {
      modStatus(quiet ? 'Hide and delete need the moderator key.' : 'Wrong moderator key.');
      return;
    }
    modKey = k;
    for (const s of KEY_STORES) storage(false, s, k);
    $('crModLock').hidden = false;
    modStatus('Unlocked - hidden items are shown, and each card can be hidden or deleted.');
    render();
  }

  function lock() {
    modKey = '';
    modLists.pumpkins = modLists.paintings = null;
    for (const s of KEY_STORES) storage(false, s, null);
    $('crModKey').value = '';
    $('crModLock').hidden = true;
    modStatus('Locked.');
    if (tab === 'pumpkins' && !autumn) tab = 'paintings';
    updateUrl();
    render();
  }

  function wireActions() {
    $('crGrid').querySelectorAll('button[data-act]').forEach((b) =>
      b.addEventListener('click', () => act(b.dataset.id, b.dataset.act)));
  }

  async function act(id, action) {
    if (!modKey) return;
    const kind = tab;                                   // 'pumpkins' or 'paintings' - same routes
    const noun = kind === 'pumpkins' ? 'pumpkin' : 'painting';
    if (action === 'delete' &&
        !confirm(`Permanently delete this ${noun}? It vanishes from every player's game and cannot be recovered.`)) return;
    try {
      const r = action === 'delete'
        ? await fetch(`${BACKEND}/api/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'X-Bark-Mod-Key': modKey } })
        : await fetch(`${BACKEND}/api/${kind}/${encodeURIComponent(id)}/${action}`, { method: 'POST', headers: { 'X-Bark-Mod-Key': modKey } });
      if (!r.ok) { modStatus(`${action} failed (${r.status}).`); return; }
      const list = modLists[kind];
      if (list) {
        if (action === 'delete') modLists[kind] = list.filter((x) => x.id !== id);
        else { const rec = list.find((x) => x.id === id); if (rec) rec.hidden = action === 'hide'; }
      }
      legacy.pumpkins = null;
      modStatus(`${action} ✓ (${id.slice(0, 8)}…)`);
      render();
    } catch (e) { modStatus(`${action} failed: ${e.message}`); }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────────────────────────

  async function boot() {
    const q = new URLSearchParams(location.search);
    const wantTab = q.get('tab');
    page = Math.max(1, parseInt(q.get('page'), 10) || 1);
    if (q.get('mod') === '1') $('crMod').open = true;

    for (const b of document.querySelectorAll('.cr-tab'))
      b.addEventListener('click', () => { if (b.dataset.tab !== tab) go(b.dataset.tab, 1); });
    $('crLights').addEventListener('click', () => {
      lit = !lit;
      const b = $('crLights');
      b.textContent = lit ? 'Blow them out' : 'Light them up';
      b.setAttribute('aria-pressed', lit ? 'true' : 'false');
      for (const v of viewers) v.setLit(lit);
    });
    $('crModUnlock').addEventListener('click', () => unlock($('crModKey').value.trim(), false));
    $('crModKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock($('crModKey').value.trim(), false); });
    $('crModLock').addEventListener('click', lock);

    await resolveBackend();
    if (!BACKEND) { status('Backend offline.'); return; }
    if (typeof THREE === 'undefined') console.warn('[creations] three.js did not load - pumpkins cannot be drawn.');

    await checkSeason();

    // A moderator who unlocked before (here or on the old pages) stays unlocked on this device.
    let saved = '';
    for (const s of KEY_STORES) saved = saved || storage(true, s) || '';
    if (saved) { $('crModKey').value = saved; try { if (await fetchModLists(saved)) { modKey = saved; $('crModLock').hidden = false; modStatus('Unlocked.'); } } catch (e) {} }

    tab = wantTab === 'paintings' ? 'paintings'
        : wantTab === 'pumpkins' && pumpkinsOpen() ? 'pumpkins'
        : pumpkinsOpen() ? 'pumpkins' : 'paintings';
    if (wantTab === 'pumpkins' && tab !== 'pumpkins') page = 1;
    updateUrl();
    await render();
    if (wantTab === 'pumpkins' && tab !== 'pumpkins')
      status('The pumpkin patch opens in autumn - here are the paintings in the meantime.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return {};
})();
