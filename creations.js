// creations.js — bark-vr.com/creations: everything players have made in BARK, for everyone.
//
// Three tabs:
//   TOYS       toys made at the Workshop's toy benches - in 3D, and ALIVE: their states and their code blocks play here
//              (toys.js). They come from the CREATIONS SERVER (backend-url.json's `creationsUrl`, run by Bark Manager).
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
// MODERATION is for the developers, signed in with GOOGLE - the site's own sign-in (the waffle /
// the editor bar), one of the DEV_EMAILS in editor.js. Their Google ID token goes to the backend as
// a Bearer token and the BACKEND decides (it checks the token with Google and the email against its
// own list); this page only decides which buttons to draw. Signed in, both tabs also list HIDDEN
// items. There is no moderator key on this page any more - nothing to leak, nothing left saved in
// a browser that unlocks it for the next person.
//
// REPORTS are for everyone: a flag on every card, a reason (or "Other" and your own words), and the
// Discord bot posts it to #reports. 🍍

const Creations = (() => {
  const PER_PAGE = { pumpkins: 10, paintings: 12, toys: 12, letters: 24, presents: 12, barkazon: 12 };
  // Winter Fest (moderators only): LETTERS to Santa + PRESENTS sent to the tree - on the main backend (workshop.js). A hidden
  // letter leaves the elves' board; a hidden present is never given to anyone. 🍍
  // Moderator-only lists on the main backend: the Workshop's letters + presents, Barkazon's listings.
  const WORKSHOP = { letters: '/api/workshop/mod/letters', presents: '/api/workshop/mod/toys', barkazon: '/api/barkazon/mod/listings' };
  const REPORTED_KEY = 'bark.reported';               // ids this browser already reported

  let BACKEND = '';
  let CREATIONS = '';                                 // the creations server (toys)
  let tab = null;
  let page = 1;
  let autumn = false;
  let mod = null;                                     // { email, token } once the backend accepted it
  const modLists = { pumpkins: null, paintings: null };
  const legacy = { pumpkins: null };                  // whole public list, if the backend cannot page
  let loadToken = 0;
  let lit = false;
  let focusId = null;                                 // ?focus=<id> - the Discord report link

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const status = (m) => { const e = $('crStatus'); if (e) e.textContent = m; };
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
  }

  async function resolveBackend() {
    if (BACKEND) return BACKEND;
    try {
      const r = await fetch('backend-url.json?t=' + Date.now());
      const j = await r.json();
      if (j && j.backendUrl) BACKEND = String(j.backendUrl).replace(/\/$/, '');
      if (j && j.creationsUrl) CREATIONS = String(j.creationsUrl).replace(/\/$/, '');
    } catch (e) { console.warn('[creations] backend-url.json failed:', e.message); }
    // Testing on this computer: ?backend= / ?creations= may point at a local server (never anywhere else).
    const q = new URLSearchParams(location.search);
    const local = (u) => (u && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u) ? u : '');
    if (local(q.get('backend'))) BACKEND = local(q.get('backend'));
    if (local(q.get('creations'))) CREATIONS = local(q.get('creations'));
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

  // Pumpkins stay public all year (the user, 2026-11-08) - `autumn` only picks which tab opens first.
  function pumpkinsOpen() { return true; }

  // ── Who is moderating ─────────────────────────────────────────────────────────────────────────

  /// The site-wide Google sign-in, as editor.js left it in localStorage. Only a developer email
  /// counts, and only while the token is still fresh (Google ID tokens last about an hour).
  function devSession() {
    let user = null, token = '', exp = 0;
    try {
      user = JSON.parse(localStorage.getItem('bark.user') || 'null');
      token = localStorage.getItem('bark.googleIdToken') || '';
      exp = +(localStorage.getItem('bark.googleIdTokenExp') || 0);
    } catch (e) { return null; }
    if (!user || !user.email || typeof isDev !== 'function' || !isDev(user.email)) return null;
    return { email: user.email, token, expired: !token || (exp > 0 && Date.now() > exp - 30000) };
  }

  const authHeaders = () => (mod ? { Authorization: 'Bearer ' + mod.token } : {});

  function modLine(text) {
    const e = $('crModLine');
    if (!e) return;
    e.textContent = text || '';
    e.hidden = !text;
  }

  async function fetchModLists(token) {
    const h = { Authorization: 'Bearer ' + token };
    const r = await fetch(`${BACKEND}/api/pumpkins`, { headers: h });
    if (r.status === 401) return false;
    modLists.pumpkins = ((await r.json()).pumpkins) || [];
    try {
      const p = await fetch(`${BACKEND}/api/paintings`, { headers: h });
      modLists.paintings = p.ok ? ((await p.json()).paintings || []) : null;
    } catch (e) { modLists.paintings = null; }
    return true;
  }

  /// Work out whether this visitor moderates, now - on load, when they sign in or out (editor.js
  /// fires `bark:auth`), and when the tab comes back into focus (a sign-in in another tab).
  async function refreshMod() {
    const s = devSession();
    const was = !!mod;
    if (!s) { mod = null; modLists.pumpkins = modLists.paintings = null; modLine(''); }
    else if (s.expired) {
      mod = null; modLists.pumpkins = modLists.paintings = null;
      modLine(`Signed in as ${s.email}, but the sign-in has expired - sign in again from the editor bar to moderate.`);
    }
    else if (!mod || mod.token !== s.token) {
      let ok = false;
      try { ok = await fetchModLists(s.token); } catch (e) { ok = false; }
      if (ok) {
        mod = { email: s.email, token: s.token };
        modLine(`Moderating as ${s.email} - hidden items are shown, and every card can be hidden or deleted.`);
      } else {
        mod = null;
        modLine(`Signed in as ${s.email}, but the backend didn't accept it - sign in again from the editor bar.`);
      }
    }
    if (was !== !!mod && tab) {
      if (tab === 'pumpkins' && !pumpkinsOpen()) tab = 'paintings';
      updateUrl();
      render();
    }
  }

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

  /// { items, total } for the current tab and page - from the moderator list when signed in as a
  /// developer (hidden ones included), otherwise from the public paged feed.
  async function fetchPage(which, pg) {
    const per = PER_PAGE[which];
    const offset = (pg - 1) * per;

    if (mod && modLists[which]) {
      const all = modLists[which];
      return { items: all.slice(offset, offset + per), total: all.length };
    }

    if (WORKSHOP[which]) {
      if (!mod) throw new Error('moderators only');
      const r = await fetch(`${BACKEND}${WORKSHOP[which]}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(r.status === 401 ? 'moderators only' : 'the workshop is offline');
      const j = await r.json();
      const all = j.letters || j.toys || j.listings || [];
      return { items: all.slice(offset, offset + per), total: all.length };
    }

    if (which === 'toys') {
      if (!CREATIONS) throw new Error('toys-offline');
      const r = await fetch(`${CREATIONS}/api/creations/public?limit=${per}&offset=${offset}`, { headers: authHeaders() });
      if (!r.ok) throw new Error('toys-offline');
      const j = await r.json();
      return { items: j.toys || [], total: j.total | 0 };
    }

    if (which === 'pumpkins') {
      if (legacy.pumpkins) return { items: legacy.pumpkins.slice(offset, offset + per), total: legacy.pumpkins.length };
      const r = await fetch(`${BACKEND}/api/pumpkins/public?limit=${per}&offset=${offset}`);
      const j = await r.json();
      if (typeof j.total === 'number') return { items: j.pumpkins || [], total: j.total };
      const all = await (await fetch(`${BACKEND}/api/pumpkins/public?limit=200`)).json();
      legacy.pumpkins = all.pumpkins || [];
      return { items: legacy.pumpkins.slice(offset, offset + per), total: legacy.pumpkins.length };
    }

    const r = await fetch(`${BACKEND}/api/paintings/public?limit=${per}&offset=${offset}`);
    if (r.status === 404) throw new Error('offline');
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

    $('crLights').hidden = tab !== 'pumpkins';
    $('crNote').textContent = tab === 'letters'
      ? 'Letters to Santa, written in the game (MODERATORS). Hide one and it leaves the elves\' board in the Workshop.'
      : tab === 'barkazon'
      ? 'Toys players are selling on BARKAZON (MODERATORS). Hide one and nobody can see or buy it; the seller sees TAKEN DOWN BY THE MODS.'
      : tab === 'presents'
      ? 'Toys sent off to the big tree (MODERATORS). From Christmas each goes to one player - hide one and it is never given.'
      : tab === 'toys'
      ? 'Made at the toy benches in the Workshop, out of shapes, bends and twists. PLAY one: click its pieces, try its states, and watch the code blocks its maker gave it.'
      : tab === 'pumpkins'
      ? 'Every pumpkin here is rebuilt from the cuts that were actually made to it - the shape it grew with, and every point placed with the knife and the scraper. Drag any of them around to see the inside.'
      : 'Painted on whiteboards in BARK and printed in-game.';

    status('Loading…');
    let res;
    try { res = await fetchPage(tab, page); }
    catch (e) {
      if (token !== loadToken) return;
      status(e.message === 'toys-offline'
        ? 'The toy shelf is not online right now - check back soon.'
        : tab === 'paintings' && e.message === 'offline'
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

    const noun = tab === 'pumpkins' ? 'pumpkin' : tab === 'toys' ? 'toy' : tab === 'letters' ? 'letter' : tab === 'presents' ? 'present' : tab === 'barkazon' ? 'listing' : 'painting';
    if (!res.total) { status(`No ${noun}s yet.`); return; }
    let line = `${res.total} ${noun}${res.total === 1 ? '' : 's'}`;
    if (pages > 1) line += ` · page ${page} of ${pages}`;
    if (mod && modLists[tab]) line += ` · ${modLists[tab].filter((x) => x.hidden).length} hidden`;
    status(line);

    if (tab === 'pumpkins') await renderPumpkins(res.items, token);
    else if (tab === 'toys') renderToys(res.items);
    else if (tab === 'letters') renderLetters(res.items);
    else if (tab === 'presents') renderPresents(res.items);
    else if (tab === 'barkazon') renderListings(res.items);
    else renderPaintings(res.items);
    if (token === loadToken) showFocus();
  }

  function modBlock(rec) {
    if (!mod) return '';
    return `
      <div class="cr-actions">
        <button class="cr-hide" data-id="${esc(rec.id)}" data-act="${rec.hidden ? 'unhide' : 'hide'}">${rec.hidden ? 'Unhide' : 'Hide'}</button>
        <button class="cr-del" data-id="${esc(rec.id)}" data-act="delete">Delete</button>
      </div>`;
  }

  function modMeta(rec) {
    if (!mod) return '';
    return `<br><b>Player:</b> <code>${esc(rec.playfabId || '—')}</code><br><b>ID:</b> <code>${esc(rec.id)}</code>`;
  }

  function reportedSet() {
    try { return new Set(JSON.parse(store(REPORTED_KEY) || '[]')); } catch (e) { return new Set(); }
  }

  function reportButton(rec) {
    const done = reportedSet().has(rec.id);
    return `<button type="button" class="cr-report" data-report="${esc(rec.id)}" ${done ? 'disabled' : ''}
              title="Report this to the Bark team" aria-label="Report">${done ? 'Reported' : '⚑ Report'}</button>`;
  }

  function cardHead(rec) {
    return `<div class="cr-meta-top"><strong>${esc(rec.artist || 'Someone')}</strong>${reportButton(rec)}</div>`;
  }

  async function renderPumpkins(items, token) {
    const grid = $('crGrid');
    const cards = items.map((rec) => {
      const card = document.createElement('div');
      card.className = 'cr-card' + (rec.hidden ? ' is-hidden' : '');
      card.dataset.id = rec.id;
      const likes = rec.likes | 0;
      card.innerHTML =
        `<canvas class="cr-canvas"></canvas>` +
        `<div class="cr-meta">${rec.hidden ? '<span class="cr-badge">HIDDEN</span><br>' : ''}` +
        cardHead(rec) +
        `${rec.strokes | 0} cut${(rec.strokes | 0) === 1 ? '' : 's'} · ` +
        `${esc(new Date(rec.createdAt || Date.now()).toLocaleDateString())}` +
        `${likes > 0 ? ` · ♥ ${likes}` : ''}${modMeta(rec)}</div>` + modBlock(rec);
      grid.appendChild(card);
      return card;
    });
    wireCards(items, 'pumpkin');

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

  function renderToys(items) {
    const grid = $('crGrid');
    for (const rec of items) {
      const card = document.createElement('div');
      card.className = 'cr-card' + (rec.hidden ? ' is-hidden' : '');
      card.dataset.id = rec.id;
      const states = Array.isArray(rec.states) ? rec.states.length : 0, rules = rec.rules | 0;
      const bits = [`${rec.parts | 0} piece${(rec.parts | 0) === 1 ? '' : 's'}`];
      if (states > 1) bits.push(`${states} states`);
      if (rules > 0) bits.push(`${rules} rule${rules === 1 ? '' : 's'}`);
      card.innerHTML =
        `<canvas class="cr-canvas"></canvas>` +
        `<div class="cr-meta">${rec.hidden ? '<span class="cr-badge">HIDDEN</span><br>' : ''}` +
        `<div class="cr-meta-top"><strong>${esc(rec.name || 'Toy')}</strong>${reportButton(rec)}</div>` +
        `by ${esc(rec.author || 'someone')} · ${bits.join(' · ')} · ${esc(new Date(rec.updatedAt || Date.now()).toLocaleDateString())}` +
        `${modMeta(rec)}</div>` +
        `<button type="button" class="cr-play" data-play="${esc(rec.id)}">▶ PLAY</button>` + modBlock(rec);
      grid.appendChild(card);
      if (window.Toys && rec.hasModel !== false) window.Toys.still(card.querySelector('.cr-canvas'), CREATIONS, rec);
    }
    grid.querySelectorAll('button[data-play]').forEach((b) => b.addEventListener('click', () => {
      const rec = items.find((x) => x.id === b.dataset.play);
      if (rec && window.Toys) window.Toys.open(CREATIONS, rec);
    }));
    grid.querySelectorAll('canvas.cr-canvas').forEach((c) => c.addEventListener('click', () => {
      const rec = items.find((x) => x.id === c.closest('.cr-card').dataset.id);
      if (rec && window.Toys) window.Toys.open(CREATIONS, rec);
    }));
    wireCards(items.map((r) => ({ ...r, artist: r.author })), 'toy');
  }

  function renderPaintings(items) {
    const grid = $('crGrid');
    for (const rec of items) {
      const card = document.createElement('div');
      card.className = 'cr-card' + (rec.hidden ? ' is-hidden' : '');
      card.dataset.id = rec.id;
      // ?v= because an edited painting keeps its id and the image is cached for a day.
      const src = `${BACKEND}/paintings/${encodeURIComponent(rec.id)}.png?v=${rec.versions || 1}`;
      card.innerHTML =
        `<a href="${src}" target="_blank" rel="noopener"><img class="cr-img" loading="lazy" src="${src}" alt="Painting by ${esc(rec.artist || 'someone')}" /></a>` +
        `<div class="cr-meta">${rec.hidden ? '<span class="cr-badge">HIDDEN</span><br>' : ''}` +
        cardHead(rec) +
        `${esc(new Date(rec.createdAt || Date.now()).toLocaleDateString())}` +
        `${(rec.versions | 0) > 1 ? ` · v${rec.versions | 0}` : ''}${modMeta(rec)}</div>` + modBlock(rec);
      const img = card.querySelector('img');
      img.addEventListener('error', () => {
        img.style.opacity = '.2';
        if (rec.hidden) card.querySelector('.cr-meta').innerHTML += '<br><em>hidden - not served</em>';
      });
      grid.appendChild(card);
    }
    wireCards(items, 'painting');
  }

  function wireCards(items, kind) {
    const grid = $('crGrid');
    grid.querySelectorAll('button[data-act]').forEach((b) =>
      b.addEventListener('click', () => act(b.dataset.id, b.dataset.act)));
    grid.querySelectorAll('button[data-report]').forEach((b) =>
      b.addEventListener('click', () => {
        const rec = items.find((x) => x.id === b.dataset.report);
        openReport(kind, b.dataset.report, rec ? rec.artist : '', b);
      }));
  }

  /// The Discord report link opens the page on the reported item. A moderator's list has every
  /// item, so the right page can be worked out; for anyone else it simply opens the tab.
  function showFocus() {
    if (!focusId) return;
    if (tab === 'toys' && window.Toys) { window.Toys.open(CREATIONS, { id: focusId, name: '', author: '' }); }
    const card = $('crGrid').querySelector(`.cr-card[data-id="${CSS.escape(focusId)}"]`);
    if (!card) return;
    card.classList.add('cr-focus');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    focusId = null;
  }

  function pageOfFocus() {
    if (!focusId || !mod) return null;
    const list = modLists[tab];
    const i = list ? list.findIndex((x) => x.id === focusId) : -1;
    return i < 0 ? null : Math.floor(i / PER_PAGE[tab]) + 1;
  }

  // ── Reporting ─────────────────────────────────────────────────────────────────────────────────

  const REASONS = [
    ['inappropriate', 'Inappropriate or sexual'],
    ['hateful', 'Hateful or offensive'],
    ['bullying', 'Bullying someone'],
    ['stolen', 'Stolen or copied'],
    ['spam', 'Spam'],
    ['other', 'Other…'],
  ];

  let reportCtx = null;       // { kind, id, button }

  function openReport(kind, id, artist, button) {
    reportCtx = { kind, id, button };
    const box = $('crReport');
    $('crReportTitle').textContent = kind === 'pumpkin' ? 'Report this pumpkin' : kind === 'toy' ? 'Report this toy' : 'Report this painting';
    $('crReportWho').textContent = artist ? `Made by ${artist}` : '';
    $('crReportReasons').innerHTML = REASONS.map(([v, label], i) => `
      <label class="cr-reason">
        <input type="radio" name="crReason" value="${v}" />
        <span>${esc(label)}</span>
      </label>`).join('');
    $('crReportOther').value = '';
    $('crReportOtherWrap').hidden = true;
    $('crReportMsg').textContent = '';
    $('crReportSend').disabled = true;
    box.hidden = false;
    document.body.classList.add('cr-modal-open');
    box.querySelectorAll('input[name="crReason"]').forEach((r) => r.addEventListener('change', () => {
      const other = r.value === 'other' && r.checked;
      $('crReportOtherWrap').hidden = !other;
      if (other) $('crReportOther').focus();
      validateReport();
    }));
    const first = box.querySelector('input[name="crReason"]');
    if (first) first.focus();
  }

  function chosenReason() {
    const r = document.querySelector('input[name="crReason"]:checked');
    return r ? r.value : null;
  }

  function validateReport() {
    const reason = chosenReason();
    const ok = !!reason && (reason !== 'other' || $('crReportOther').value.trim().length >= 3);
    $('crReportSend').disabled = !ok;
    return ok;
  }

  function closeReport() {
    $('crReport').hidden = true;
    document.body.classList.remove('cr-modal-open');
    if (reportCtx && reportCtx.button) reportCtx.button.focus();
    reportCtx = null;
  }

  async function sendReport() {
    if (!reportCtx || !validateReport()) return;
    const send = $('crReportSend');
    send.disabled = true;
    $('crReportMsg').textContent = 'Sending…';
    try {
      const r = await fetch(reportCtx.kind === 'toy' ? `${CREATIONS}/api/creations/report` : `${BACKEND}/api/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: reportCtx.kind, id: reportCtx.id, reason: chosenReason(),
                               details: $('crReportOther').value.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { $('crReportMsg').textContent = j.error ? `Couldn't send: ${j.error}.` : `Couldn't send (${r.status}).`; send.disabled = false; return; }
      const done = reportedSet(); done.add(reportCtx.id);
      store(REPORTED_KEY, JSON.stringify([...done].slice(-300)));
      if (reportCtx.button) { reportCtx.button.textContent = 'Reported'; reportCtx.button.disabled = true; }
      closeReport();
      toast('Thanks - the Bark team will take a look.');
    } catch (e) {
      $('crReportMsg').textContent = "Couldn't reach Bark right now - try again in a minute.";
      send.disabled = false;
    }
  }

  function toast(text) {
    const t = $('crToast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 4000);
  }

  // ── Tabs, pages, URL ──────────────────────────────────────────────────────────────────────────

  function renderLetters(items) {
    const grid = $('crGrid');
    for (const rec of items) {
      const card = document.createElement('div');
      card.className = 'cr-card' + (rec.hidden ? ' is-hidden' : '');
      card.dataset.id = rec.id;
      card.innerHTML =
        `<div class="cr-meta">${rec.hidden ? '<span class="cr-badge">HIDDEN</span><br>' : ''}` +
        `<div class="cr-meta-top"><strong>${esc(rec.name || 'Someone')}</strong></div>` +
        `<p style="white-space:pre-wrap;margin:.5em 0">${esc(rec.text || '')}</p>` +
        `${esc(new Date(rec.at || Date.now()).toLocaleString())} · ${(rec.answers || []).length} toy(s) made for it` +
        `${modMeta(rec)}</div>` + modBlock(rec);
      grid.appendChild(card);
    }
  }

  function renderPresents(items) {
    const grid = $('crGrid');
    for (const rec of items) {
      const card = document.createElement('div');
      card.className = 'cr-card' + (rec.hidden ? ' is-hidden' : '');
      card.dataset.id = rec.id;
      const kind = ['gift-wrapped', 'in a toy box', 'on a blister card'][rec.kind | 0] || 'wrapped';
      card.innerHTML =
        (rec.hasModel ? `<canvas class="cr-canvas"></canvas>` : '') +
        `<div class="cr-meta">${rec.hidden ? '<span class="cr-badge">HIDDEN</span><br>' : ''}` +
        `<div class="cr-meta-top"><strong>${esc(rec.name || 'Toy')}</strong></div>` +
        `made by ${esc(rec.maker || 'an elf')} · ${kind}${rec.letter ? ' · for a letter' : ''} · ${rec.givenTo ? 'GIVEN' : 'under the tree'} · ${esc(new Date(rec.at || Date.now()).toLocaleDateString())}` +
        `${modMeta(rec)}</div>` + modBlock(rec);
      grid.appendChild(card);
      if (rec.hasModel && window.Toys) {
        const base = `${BACKEND}${WORKSHOP.presents}/${encodeURIComponent(rec.id)}`;
        window.Toys.still(card.querySelector('.cr-canvas'), BACKEND, { ...rec, detailsUrl: base, modelUrl: base + '/model', headers: authHeaders() });
      }
    }
  }

  function renderListings(items) {
    const grid = $('crGrid');
    for (const rec of items) {
      const card = document.createElement('div');
      card.className = 'cr-card' + (rec.hidden ? ' is-hidden' : '');
      card.dataset.id = rec.id;
      card.innerHTML =
        (rec.hasModel ? `<canvas class="cr-canvas"></canvas>` : '') +
        `<div class="cr-meta">${rec.hidden ? '<span class="cr-badge">HIDDEN</span><br>' : ''}` +
        `<div class="cr-meta-top"><strong>${esc(rec.name || 'Toy')}</strong></div>` +
        `sold by ${esc(rec.sellerName || 'someone')} · ${rec.price ? (rec.price | 0) + ' PC' : 'FREE'} · ${rec.sales | 0} sold (${rec.earned | 0} PC) · ${esc(new Date(rec.updated || rec.at || Date.now()).toLocaleDateString())}` +
        `${modMeta({ ...rec, playfabId: rec.seller })}</div>` + modBlock(rec);
      grid.appendChild(card);
      if (rec.hasModel && window.Toys) {
        const base = `${BACKEND}${WORKSHOP.barkazon}/${encodeURIComponent(rec.id)}`;
        window.Toys.still(card.querySelector('.cr-canvas'), BACKEND, { ...rec, detailsUrl: base, modelUrl: base + '/model', headers: authHeaders() });
      }
    }
  }

  function setTabs() {
    $('tab-pumpkins').hidden = !pumpkinsOpen();
    $('tab-letters').hidden = !mod;
    $('tab-presents').hidden = !mod;
    $('tab-barkazon').hidden = !mod;
    for (const b of document.querySelectorAll('.cr-tab[data-tab]'))
      b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
  }

  function updateUrl() {
    const q = new URLSearchParams(location.search);
    q.set('tab', tab);
    if (page > 1) q.set('page', String(page)); else q.delete('page');
    q.delete('mod');
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

  // ── Moderation actions ────────────────────────────────────────────────────────────────────────

  async function act(id, action) {
    if (!mod) return;
    const kind = tab;                                   // 'pumpkins' or 'paintings' - same routes; toys live on the creations server
    const noun = kind === 'pumpkins' ? 'pumpkin' : kind === 'toys' ? 'toy' : kind === 'letters' ? 'letter' : kind === 'presents' ? 'present' : kind === 'barkazon' ? 'listing' : 'painting';
    const base = WORKSHOP[kind] ? `${BACKEND}${WORKSHOP[kind]}` : kind === 'toys' ? `${CREATIONS}/api/creations` : `${BACKEND}/api/${kind}`;
    if (action === 'delete' &&
        !confirm(`Permanently delete this ${noun}? It vanishes from every player's game and cannot be recovered.`)) return;
    try {
      const r = action === 'delete'
        ? await fetch(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() })
        : await fetch(`${base}/${encodeURIComponent(id)}/${action}`, { method: 'POST', headers: authHeaders() });
      if (r.status === 401) {
        mod = null;
        modLine('Your sign-in has expired - sign in again from the editor bar to keep moderating.');
        render();
        return;
      }
      if (!r.ok) { toast(`${action} failed (${r.status}).`); return; }
      // Deleting a Barkazon listing removes its TOY too (the creations server remembers it: no re-upload, and every
      // game drops it - and the copies people bought - from their saved toys).
      if (kind === 'barkazon' && action === 'delete') {
        const rec = (modLists[kind] || []).find((x) => x.id === id);
        if (rec && rec.toyId) {
          try { await fetch(`${CREATIONS}/api/creations/${encodeURIComponent(String(rec.toyId).toLowerCase())}`, { method: 'DELETE', headers: authHeaders() }); }
          catch (e) { console.warn('[creations] could not remove the listing\'s toy:', e.message); }
        }
      }
      const list = modLists[kind];
      if (list) {
        if (action === 'delete') modLists[kind] = list.filter((x) => x.id !== id);
        else { const rec = list.find((x) => x.id === id); if (rec) rec.hidden = action === 'hide'; }
      }
      legacy.pumpkins = null;
      toast(`${action === 'delete' ? 'Deleted' : action === 'hide' ? 'Hidden' : 'Unhidden'} ✓`);
      render();
    } catch (e) { toast(`${action} failed: ${e.message}`); }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────────────────────────

  async function boot() {
    const q = new URLSearchParams(location.search);
    const wantTab = q.get('tab');
    page = Math.max(1, parseInt(q.get('page'), 10) || 1);
    focusId = q.get('focus');

    for (const b of document.querySelectorAll('.cr-tab[data-tab]'))
      b.addEventListener('click', () => { if (b.dataset.tab !== tab) go(b.dataset.tab, 1); });
    $('crLights').addEventListener('click', () => {
      lit = !lit;
      const b = $('crLights');
      b.textContent = lit ? 'Blow them out' : 'Light them up';
      b.setAttribute('aria-pressed', lit ? 'true' : 'false');
      for (const v of viewers) v.setLit(lit);
    });

    // The report dialog.
    $('crReportCancel').addEventListener('click', closeReport);
    $('crReportClose').addEventListener('click', closeReport);
    $('crReportBackdrop').addEventListener('click', closeReport);
    $('crReportSend').addEventListener('click', sendReport);
    $('crReportOther').addEventListener('input', validateReport);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('crReport').hidden) closeReport(); });

    await resolveBackend();
    if (!BACKEND) { status('Backend offline.'); return; }
    if (typeof THREE === 'undefined') console.warn('[creations] three.js did not load - pumpkins cannot be drawn.');

    await checkSeason();
    await refreshMod();

    // (moderators can link straight to LETTERS / PRESENTS / BARKAZON - e.g. ?tab=letters)
    tab = wantTab === 'toys' ? 'toys'
        : mod && ['letters', 'presents', 'barkazon'].includes(wantTab) ? wantTab
        : wantTab === 'paintings' ? 'paintings'
        : wantTab === 'pumpkins' && pumpkinsOpen() ? 'pumpkins'
        : autumn ? 'pumpkins' : 'toys';
    if (wantTab === 'pumpkins' && tab !== 'pumpkins') page = 1;
    const fp = pageOfFocus();
    if (fp) page = fp;
    updateUrl();
    await render();
    if (wantTab === 'pumpkins' && tab !== 'pumpkins')
      status('The pumpkin patch opens in autumn - here are the paintings in the meantime.');

    // Signing in or out - here (editor.js fires bark:auth) or in another tab - changes what shows.
    window.addEventListener('bark:auth', refreshMod);
    window.addEventListener('focus', refreshMod);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return {};
})();
