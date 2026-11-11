// barkazon.js — bark-vr.com/barkazon: BARKAZON, the players' toy shop, EXACTLY as the Workshop's computer shows it in the game
// (BarkazonKiosk): the Bemu Interwebs page with its orange header, SHOP / SELL, NEWEST / TOP SELLERS / CHEAPEST, the pager,
// four product cards a page (the toy's photo, its name, who made it, its price), the picked toy's details with the amber BUY -
// every place and size is the game's own (the screen is 0.88 x 0.55 m there; here 1 cqw = 1/100 of its width) - and beside it
// the DISPLAY STAND, where the picked toy turns (toys.js spin, from the Creations server) - and THE TOY BOOK, page by page, as a
// developer's game last printed it (BookPrinter -> /api/barkazon/book). Buying and selling happen in the game (they need your
// PlayFab sign-in); here BUY says where. A phone gets the same screen with its cards two by two. 🍍

(() => {
  const PER = 4;
  const SORTS = ['new', 'top', 'cheap'], SORT_NAMES = ['NEWEST', 'TOP SELLERS', 'CHEAPEST'];
  const W = 0.88, H = 0.55;                              // the game's screen, metres
  let BACKEND = '', CREATIONS = '';
  const S = { selling: false, sort: 0, page: 0, pages: 1, list: null, loading: false, pick: null, flash: '', flashUntil: 0, narrow: false };
  let spin = null, flashTimer = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const price = (p) => (p | 0) <= 0 ? 'FREE' : (p | 0) + ' PC';
  const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const cq = (m) => (m / W * 100).toFixed(3) + 'cqw';                     // game metres -> container units
  const font = (size) => (163.6 * size).toFixed(2) + 'cqw';                // a BenchUI text size -> its em (TMP 6 x size x 2.4)

  /// Put `el` where the game puts it: a Rect(x, y, w, h) in screen metres (centre origin, y up). Only on the full-size screen.
  function at(el, x, y, w, h, parent) {
    if (S.narrow) return el;
    const px = parent ? parent.x : -W / 2, ptop = parent ? parent.y + parent.h : H / 2;
    el.style.position = 'absolute';
    el.style.left = cq(x - px);
    el.style.top = cq(ptop - (y + h));
    el.style.width = cq(w);
    el.style.height = cq(h);
    return el;
  }
  function make(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  async function resolveBackend() {
    try {
      const j = await (await fetch('backend-url.json?t=' + Date.now())).json();
      if (j && j.backendUrl) BACKEND = String(j.backendUrl).replace(/\/$/, '');
      if (j && j.creationsUrl) CREATIONS = String(j.creationsUrl).replace(/\/$/, '');
    } catch (e) { console.warn('[barkazon] backend-url.json failed:', e.message); }
    const q = new URLSearchParams(location.search);
    const local = (u) => (u && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u) ? u : '');
    if (local(q.get('backend'))) BACKEND = local(q.get('backend'));
    if (local(q.get('creations'))) CREATIONS = local(q.get('creations'));
  }

  // ── THE SCREEN ────────────────────────────────────────────────────────────────────────────────────────────────

  function flash(text) {
    S.flash = text; S.flashUntil = Date.now() + 4500;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(draw, 4600);
    draw();
  }

  function button(label, rect, onClick, opts) {
    const b = make('button', 'bz-btn' + (opts && opts.cls ? ' ' + opts.cls : '') + (opts && opts.on ? ' on' : ''), label);
    b.type = 'button';
    if (opts && opts.size) b.style.fontSize = S.narrow ? '' : font(opts.size);
    if (opts && opts.aria) b.setAttribute('aria-label', opts.aria);
    if (opts && opts.on) b.setAttribute('aria-pressed', 'true');
    if (rect) at(b, ...rect);
    b.addEventListener('click', onClick);
    return b;
  }

  function text(cls, html, rect, size, parent) {
    const t = make('div', 'bz-abs bz-text ' + cls, html);
    if (rect) at(t, ...rect, parent);
    if (size && !S.narrow) t.style.fontSize = font(size);
    return t;
  }

  function draw() {
    drawScreen();
    fit($('bzScreen'));
  }

  function drawScreen() {
    const screen = $('bzScreen');
    S.narrow = screen.clientWidth < 560;
    screen.classList.toggle('narrow', S.narrow);
    screen.innerHTML = '';

    // the header: barkazon on the Bemu Interwebs, the status, SHOP / SELL
    const head = make('div', 'bz-abs bz-head');
    head.appendChild(make('div', 'bz-abs bz-brand', '<b>barkazon</b> <small>on the Bemu Interwebs</small>'));
    const st = make('div', 'bz-abs bz-status', esc(Date.now() < S.flashUntil ? S.flash : S.loading ? 'LOADING…' : ''));
    head.appendChild(st);
    head.appendChild(button('SHOP', [0.12, H / 2 - 0.06, 0.145, 0.05], () => { if (S.selling) { S.selling = false; refresh(); } }, { on: !S.selling, size: 0.019 }));
    head.appendChild(button('SELL', [0.275, H / 2 - 0.06, 0.145, 0.05], () => { if (!S.selling) { S.selling = true; pick(null); draw(); } }, { on: S.selling, size: 0.019 }));
    screen.appendChild(head);

    if (S.selling) { drawSell(screen); return; }

    // the sorts + the pager
    const bar = make('div', 'bz-toolbar');
    SORT_NAMES.forEach((n, i) => bar.appendChild(button(n, [-0.42 + i * 0.152, 0.142, 0.146, 0.044], () => {
      if (S.sort === i) return;
      S.sort = i; S.page = 0; pick(null); refresh();
    }, { cls: 'soft', on: S.sort === i, size: 0.014 })));
    if (S.pages > 1) {
      if (S.page > 0) bar.appendChild(button('&lt;', [0.24, 0.142, 0.055, 0.044], () => { S.page--; pick(null); refresh(); }, { cls: 'soft', size: 0.022, aria: 'Previous page' }));
      bar.appendChild(text('c bz-pagenum', (S.page + 1) + '/' + S.pages, [0.297, 0.142, 0.065, 0.044], 0.015));
      if (S.page < S.pages - 1) bar.appendChild(button('&gt;', [0.365, 0.142, 0.055, 0.044], () => { S.page++; pick(null); refresh(); }, { cls: 'soft', size: 0.022, aria: 'Next page' }));
    }
    screen.appendChild(bar);

    if (!S.list || !S.list.length) {
      if (!S.loading) screen.appendChild(text('c wrap bz-empty', S.list === null ? "Couldn't reach Barkazon - try again soon."
        : "Nobody's selling a toy yet.<br>Make one at a toy bench in the Workshop, then SELL it here!", [-0.4, -0.08, 0.8, 0.16], 0.019));
      return;
    }

    // the product cards (Cell(i) = Rect(-0.42 + i * 0.212, -0.12, 0.2, 0.245))
    const cards = make('div', 'bz-cards');
    S.list.slice(0, PER).forEach((l, i) => {
      const r = { x: -0.42 + i * 0.212, y: -0.12, w: 0.2, h: 0.245 };
      const on = S.pick && S.pick.id === l.id;
      const card = button('', [r.x, r.y, r.w, r.h], () => pick(l), { cls: 'bz-card', on, aria: `${l.name || 'Toy'} by ${l.maker || 'someone'}, ${price(l.price)}` });
      const ph = make('div', 'bz-photo');
      at(ph, r.x + (r.w - 0.118) / 2, r.y + r.h - 0.126, 0.118, 0.118, r);
      if (l.photo) {
        const img = make('img');
        img.alt = ''; img.loading = 'lazy';
        img.src = `${BACKEND}/api/barkazon/listing/${encodeURIComponent(l.id)}/photo?v=${encodeURIComponent(l.updated || l.at || '')}`;
        img.addEventListener('error', () => { ph.innerHTML = '…'; });
        ph.appendChild(img);
      } else ph.textContent = '…';
      card.appendChild(ph);
      card.appendChild(text('c bz-name', '<b>' + esc(short(l.name || 'Toy', 16)) + '</b>', [r.x + 0.008, r.y + 0.066, r.w - 0.016, 0.03], 0.0155, r));
      card.appendChild(text('c bz-sub', 'by ' + esc(short(l.maker || 'someone', 14)), [r.x + 0.008, r.y + 0.042, r.w - 0.016, 0.024], 0.0115, r));
      card.appendChild(text('c bz-price', esc(price(l.price)), [r.x + 0.008, r.y + 0.008, r.w - 0.016, 0.034], 0.019, r));
      cards.appendChild(card);
    });
    screen.appendChild(cards);

    // the picked toy's details + BUY
    const bottom = make('div', 'bz-bottom');
    if (!S.pick) bottom.appendChild(text('c bz-hint', 'Tap a toy to see it spin on the stand.', [-0.4, -0.245, 0.8, 0.09], 0.017));
    else {
      const p = S.pick;
      bottom.appendChild(text('wrap bz-detail', `<span><b>${esc(p.name || 'Toy')}</b><br><span style="font-size:72%">made by ${esc(p.maker || 'someone')}  ·  ${p.parts | 0} parts  ·  ${p.sales | 0} sold</span></span>`,
        [-0.42, -0.255, 0.52, 0.11], 0.02));
      bottom.appendChild(button((p.price | 0) <= 0 ? 'GET IT FREE' : 'BUY  ' + price(p.price), [0.13, -0.25, 0.29, 0.1],
        () => flash('BUY IT AT THE BARKAZON COMPUTER IN THE WORKSHOP'), { cls: 'amber bz-buy', size: 0.021 }));
    }
    screen.appendChild(bottom);
  }

  /// A long label SHRINKS TO FIT its box, as TMP does in the game (the web font runs a little wider than the game's).
  function fit(screen) {
    if (S.narrow) return;
    for (const el of screen.querySelectorAll('.bz-brand, .bz-text:not(.wrap), .bz-btn:not(.bz-card)')) {
      if (el.dataset.size === undefined) el.dataset.size = el.style.fontSize || '';     // (its own size, before any fitting)
      el.style.fontSize = el.dataset.size;
      const over = el.scrollWidth / Math.max(1, el.clientWidth);
      if (over > 1.02) el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) / over * 0.97) + 'px';
    }
  }

  function drawSell(screen) {
    screen.appendChild(text('c wrap bz-empty',
      'Sell the toys you made at the BARKAZON computer in the Workshop.<br>Pick one of yours, set its price, LIST IT - it shows up here for everyone.',
      [-0.4, -0.12, 0.8, 0.24], 0.019));
  }

  // ── THE LISTINGS ──────────────────────────────────────────────────────────────────────────────────────────────

  let asking = 0;
  async function refresh() {
    const me = ++asking;
    S.loading = true; draw();
    try {
      const r = await fetch(`${BACKEND}/api/barkazon/listings?page=${S.page}&sort=${SORTS[S.sort]}&per=${PER}`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      if (me !== asking) return;
      S.list = j.listings || [];
      S.pages = Math.max(1, j.pages | 0);
      S.page = Math.max(0, Math.min(S.pages - 1, j.page | 0));
    } catch (e) {
      if (me !== asking) return;
      S.list = null;
      S.flash = "COULDN'T REACH BARKAZON - TRY AGAIN SOON"; S.flashUntil = Date.now() + 4500;
    }
    S.loading = false;
    draw();
  }

  // ── THE STAND: the picked toy turning (from the Creations server - the maker's toy, as they last saved it) ─────────

  function pick(l) {
    S.pick = l ? { ...l } : null;
    if (spin) { spin.dispose(); spin = null; }
    const old = $('bzSpin');
    const canvas = make('canvas', 'bz-spin');                          // a fresh canvas each time (one WebGL context each)
    canvas.id = 'bzSpin'; canvas.width = 250; canvas.height = 250;
    canvas.setAttribute('aria-label', l ? `${l.name || 'The toy'}, turning on the stand` : 'The display stand');
    old.replaceWith(canvas);
    const tag = $('bzStandTag');
    if (!l) { tag.textContent = 'Tap a toy to see it spin on the stand.'; draw(); return; }
    tag.innerHTML = `<b>${esc(l.name || 'Toy')}</b> by ${esc(l.maker || 'someone')}`;
    const showPhoto = () => {
      if (!S.pick || S.pick.id !== l.id || !l.photo) return;
      const g = canvas.getContext('2d');
      if (!g) return;
      const img = new Image();
      img.onload = () => { g.clearRect(0, 0, 250, 250); g.drawImage(img, 25, 25, 200, 200); };
      img.src = `${BACKEND}/api/barkazon/listing/${encodeURIComponent(l.id)}/photo?v=${encodeURIComponent(l.updated || l.at || '')}`;
    };
    if (window.Toys && window.Toys.spin && CREATIONS && l.toyId) {
      const id = String(l.toyId).toLowerCase();
      spin = window.Toys.spin(canvas, CREATIONS, { id, updatedAt: l.updated || l.at, onError: () => { if (spin) { spin.dispose(); spin = null; } const c2 = make('canvas', 'bz-spin'); c2.id = 'bzSpin'; c2.width = 250; c2.height = 250; canvas.replaceWith(c2); showPhotoOn(c2, l); } });
      const play = make('button', 'bz-btn amber bz-play', '▶ PLAY IT');
      play.type = 'button';
      play.style.position = 'static'; play.style.fontSize = '15px'; play.style.padding = '8px 16px'; play.style.borderRadius = '8px';
      play.addEventListener('click', () => window.Toys.open(CREATIONS, { id, name: l.name, author: l.maker, updatedAt: l.updated || l.at }));
      tag.appendChild(document.createElement('br'));
      tag.appendChild(play);
    } else showPhoto();
    draw();
  }

  function showPhotoOn(canvas, l) {
    if (!l.photo) return;
    const g = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => { g.clearRect(0, 0, 250, 250); g.drawImage(img, 25, 25, 200, 200); };
    img.src = `${BACKEND}/api/barkazon/listing/${encodeURIComponent(l.id)}/photo?v=${encodeURIComponent(l.updated || l.at || '')}`;
    const play = $('bzStandTag').querySelector('.bz-play');
    if (play) play.remove();
  }

  // ── THE TOY BOOK ──────────────────────────────────────────────────────────────────────────────────────────────

  const B = { count: 0, pages: {}, at: null, spread: 0 };
  const spreads = () => (B.count <= 0 ? 0 : 1 + Math.ceil((B.count - 1) / 2));
  const pageUrl = (i) => `${BACKEND}/api/barkazon/book/page/${i}?v=${encodeURIComponent((B.pages[i] && B.pages[i].at) || '')}`;

  async function loadBook() {
    try {
      const r = await fetch(`${BACKEND}/api/barkazon/book?t=${Date.now()}`);
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      B.count = j.count | 0; B.at = j.at; B.pages = {};
      for (const p of j.pages || []) B.pages[p.index] = p;
    } catch (e) { B.count = 0; }
    const q = new URLSearchParams(location.search);
    const want = parseInt(q.get('spread'), 10);
    if (want >= 0) B.spread = Math.min(Math.max(0, spreads() - 1), want);
    drawBook();
  }

  function pageEl(i, side) {
    const p = make('div', 'bz-page ' + side);
    if (i < 0 || i >= B.count) { p.classList.add('blank'); return p; }
    if (B.pages[i]) {
      const img = make('img');
      img.alt = i === 0 ? 'The toy book\'s cover' : `Page ${i + 1} of the toy book`;
      img.src = pageUrl(i);
      img.addEventListener('error', () => { p.innerHTML = '<div class="bz-unprinted">This page hasn\'t been printed yet.<br>It\'s in the book in the game!</div>'; });
      p.appendChild(img);
    } else p.innerHTML = '<div class="bz-unprinted">This page hasn\'t been printed yet.<br>It\'s in the book in the game!</div>';
    return p;
  }

  function drawBook() {
    const book = $('bzBook'), note = $('bzBookNote');
    book.innerHTML = '';
    const n = spreads();
    if (!n) {
      note.textContent = "The toy book hasn't been printed for the website yet - it's on the rack by the Barkazon computer in the Workshop.";
      $('bzBookPrev').hidden = $('bzBookNext').hidden = true; $('bzBookPn').textContent = '';
      return;
    }
    $('bzBookPrev').hidden = $('bzBookNext').hidden = false;
    const printed = Object.keys(B.pages).filter((k) => +k < B.count).length;
    note.textContent = `${B.count} pages${printed < B.count ? ` · ${printed} printed so far` : ''}${B.at ? ' · this edition ' + new Date(B.at).toLocaleDateString() : ''}`;
    const s = B.spread;
    const left = s === 0 ? -1 : 2 * s - 1, right = s === 0 ? 0 : 2 * s;
    const spread = make('div', 'bz-spread');
    spread.appendChild(pageEl(left, 'left'));
    spread.appendChild(pageEl(right, 'right'));
    book.appendChild(spread);
    $('bzBookPn').textContent = s === 0 ? 'COVER' : right < B.count ? `PAGES ${left + 1}-${right + 1}` : `PAGE ${left + 1}`;
    $('bzBookPrev').disabled = s <= 0;
    $('bzBookNext').disabled = s >= n - 1;
    // the next spread's pictures, ready before the turn
    for (const i of [2 * (s + 1) - 1, 2 * (s + 1)]) if (i < B.count && B.pages[i]) { const im = new Image(); im.src = pageUrl(i); }
  }

  function turn(d) {
    const n = spreads();
    const s = Math.max(0, Math.min(n - 1, B.spread + d));
    if (s === B.spread) return;
    B.spread = s;
    const q = new URLSearchParams(location.search);
    if (s) q.set('spread', String(s)); else q.delete('spread');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
    drawBook();
  }

  // ── BOOT ──────────────────────────────────────────────────────────────────────────────────────────────────────

  async function boot() {
    $('bzBookPrev').addEventListener('click', () => turn(-1));
    $('bzBookNext').addEventListener('click', () => turn(1));
    document.addEventListener('keydown', (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (document.querySelector('.ty-player')) return;                  // (the toy player has the keys)
      if (e.key === 'ArrowLeft') turn(-1);
      if (e.key === 'ArrowRight') turn(1);
    });
    let wasNarrow = null;
    if (typeof ResizeObserver !== 'undefined')
      new ResizeObserver(() => { const n = $('bzScreen').clientWidth < 560; if (n !== wasNarrow) { wasNarrow = n; draw(); } }).observe($('bzScreen'));
    draw();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fit($('bzScreen')));
    await resolveBackend();
    if (!BACKEND) { S.list = null; S.flash = 'BARKAZON IS OFFLINE RIGHT NOW'; S.flashUntil = Date.now() + 1e9; draw(); return; }
    await Promise.all([refresh(), loadBook()]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
