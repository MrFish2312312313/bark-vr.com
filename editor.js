/* ===========================================================
   BARKVR — editor.js
   Site-wide editor mode. Google Sign-In + GitHub API.
   ===========================================================

   QUICK SETUP (one time):

   1. Create a Google OAuth Client ID:
        https://console.cloud.google.com/apis/credentials
      - "Create Credentials" -> "OAuth client ID" -> "Web application"
      - Authorized JavaScript origins:
            https://bark-vr.com
            http://localhost:5500   (or whatever you use locally)
      - Copy the Client ID, paste it below into GOOGLE_CLIENT_ID.

   2. Create a GitHub Personal Access Token (fine-grained):
        https://github.com/settings/personal-access-tokens/new
      - Resource owner: MrFish2312312313
      - Repo access: only "bark-vr.com"
      - Permissions: Contents -> Read and write
      - You'll paste it into the editor the first time you save.
        It's stored in your browser's localStorage only.

   3. Push these files to the repo. Done — visit the site, sign in,
      and you'll see the editor controls.
   =========================================================== */

// 🍍 hidden ingredient
const GOOGLE_CLIENT_ID = '30694987707-f9vq4vafl2s4bpli7jr3lap98jskbcjq.apps.googleusercontent.com';

const ALLOWED_EMAILS = [
  'portergrahamrussell@icloud.com',
  'barkvrofficial@gmail.com',
  'mrfeesh456@gmail.com',
  'job.elliot.mason@gmail.com',
];

const REPO_OWNER  = 'MrFish2312312313';
const REPO_NAME   = 'bark-vr.com';
const REPO_BRANCH = 'main';
const DATA_PATH   = 'data.json';
const MEDIA_DIR   = 'media';

// ─── Bark backend (Discord-bot link server) ────────────────────────────────
// The bark-manager auto-publishes the current Cloudflare Tunnel URL into
// backend-url.json (and git-pushes it). We fetch that file dynamically here
// so the site always has the latest URL without manual edits.
let BARK_BACKEND_URL = '';

async function loadBackendUrl() {
  try {
    const r = await fetch('backend-url.json?t=' + Date.now());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j && j.backendUrl) {
      BARK_BACKEND_URL = String(j.backendUrl).replace(/\/$/, '');
    }
  } catch (e) {
    console.warn('[bark] Could not load backend-url.json:', e.message);
  }
  return BARK_BACKEND_URL;
}

// ----------------------------------------------------------
//  STATE
// ----------------------------------------------------------
const BarkEditor = {
  data: null,
  dataSha: null,        // GitHub file SHA, needed for updates
  user: null,           // { email, name, picture }
  editing: false,       // editor mode toggle
  dirty: false,         // unsaved local changes
};

// ----------------------------------------------------------
//  DATA LOAD
// ----------------------------------------------------------
async function loadData() {
  // Always fetch fresh from the repo file. Bust cache so editors see updates.
  const res = await fetch(`data.json?t=${Date.now()}`);
  if (!res.ok) throw new Error('Failed to load data.json');
  BarkEditor.data = await res.json();
  return BarkEditor.data;
}

// ----------------------------------------------------------
//  RENDER: TEAM
// ----------------------------------------------------------
function renderTeam(container) {
  if (!container) return;
  const team = BarkEditor.data.team || [];
  container.innerHTML = '';
  team.forEach((m, i) => {
    const card = document.createElement('a');
    card.className = 'team-card team-card-link';
    card.href = `team.html?id=${encodeURIComponent(m.id)}`;
    card.innerHTML = `
      <div class="team-avatar ${m.avatarClass || ''}">
        <img src="${escapeAttr(m.photo)}" alt="${escapeAttr(m.name)}" />
      </div>
      <div class="team-info">
        <h3>${escapeHtml(m.name)}</h3>
        <p>${escapeHtml(m.role || '')}</p>
      </div>
      ${BarkEditor.editing ? editControls('team', i) : ''}
    `;
    container.appendChild(card);
  });

  if (BarkEditor.editing) {
    const add = document.createElement('button');
    add.className = 'team-card add-card';
    add.type = 'button';
    add.innerHTML = `<div class="add-plus">+</div><div class="add-label">Add Member</div>`;
    add.onclick = () => openTeamModal(null);
    container.appendChild(add);
  }
}

// ----------------------------------------------------------
//  RENDER: GAMES (home teaser — first game only)
// ----------------------------------------------------------
function renderGamesTeaser(container) {
  if (!container) return;
  const games = BarkEditor.data.games || [];
  container.innerHTML = '';

  games.slice(0, 1).forEach((g, i) => {
    const card = document.createElement('div');
    card.className = 'game-card-home';
    card.innerHTML = `
      <div class="game-card-content">
        <span class="game-tag">${escapeHtml(g.tag || '')}</span>
        <h3>${escapeHtml(g.name)}</h3>
        <p>${escapeHtml(g.shortDesc || '')}</p>
        <div class="game-links">
          <a href="${escapeAttr(g.downloadUrl)}" target="_blank" class="btn-primary">Download on ${escapeHtml(g.downloadLabel || 'Store')}</a>
          <a href="games.html#${escapeAttr(g.id)}" class="btn-ghost">View Details →</a>
        </div>
      </div>
      <div class="game-card-visual">
        <img src="${escapeAttr(g.screenshot)}" alt="${escapeAttr(g.name)} gameplay" class="game-screenshot-img" />
      </div>
      ${BarkEditor.editing ? editControls('game', i) : ''}
    `;
    container.appendChild(card);
  });
}

// ----------------------------------------------------------
//  RENDER: GAMES PAGE (full detail, stacked)
// ----------------------------------------------------------
function renderGamesPage(container) {
  if (!container) return;
  const games = BarkEditor.data.games || [];
  container.innerHTML = '';

  games.forEach((g, i) => {
    const section = document.createElement('div');
    section.className = 'game-detail-inner';
    section.id = g.id;
    section.innerHTML = `
      <div class="game-detail-text">
        <span class="game-tag">${escapeHtml(g.tag || '')}</span>
        <h2>${escapeHtml(g.name)}</h2>
        <p class="game-tagline">${escapeHtml(g.tagline || '')}</p>
        <p class="game-desc">${escapeHtml(g.fullDesc || g.shortDesc || '')}</p>
        <div class="platform-section">
          <p class="platform-label">AVAILABLE ON</p>
          <a href="${escapeAttr(g.downloadUrl)}" target="_blank" class="platform-btn">
            <span class="platform-icon">◉</span>
            ${escapeHtml(g.downloadLabel || 'STORE')}
          </a>
          <p class="more-platforms">${escapeHtml(g.morePlatforms || '')}</p>
        </div>
      </div>

      <div class="game-screenshots">
        <img src="${escapeAttr(g.screenshot)}" alt="${escapeAttr(g.name)} gameplay" class="screenshot-real main-shot" />
        <div class="screenshots-row">
          ${(g.reviews || []).map((r, ri) => `
            <div class="review-card ${(g.reviews.length % 2 === 1 && ri === g.reviews.length - 1) ? 'review-card-wide' : ''}">
              <div class="review-stars">${starRow(r.stars)}</div>
              <div class="review-author">${escapeHtml(r.author)}</div>
              <div class="review-text">"${escapeHtml(r.text)}"</div>
            </div>
          `).join('')}
        </div>
      </div>
      ${BarkEditor.editing ? editControls('game', i) : ''}
    `;
    container.appendChild(section);
  });

  if (BarkEditor.editing) {
    const add = document.createElement('button');
    add.className = 'btn-secondary add-game-btn';
    add.type = 'button';
    add.textContent = '+ Add New Game';
    add.onclick = () => openGameModal(null);
    container.appendChild(add);
  }
}

// ----------------------------------------------------------
//  RENDER: SINGLE TEAM MEMBER (team.html)
// ----------------------------------------------------------
function renderTeamMember(container) {
  if (!container) return;
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const m = (BarkEditor.data.team || []).find(t => t.id === id);

  if (!m) {
    container.innerHTML = `
      <div class="container">
        <p class="section-label">// NOT FOUND</p>
        <h2 class="section-title">Member not found</h2>
        <a href="index.html#about" class="btn-secondary">← Back to team</a>
      </div>`;
    return;
  }

  document.title = `${m.name} | BARKVR`;
  const teamIdx = BarkEditor.data.team.indexOf(m);

  container.innerHTML = `
    <div class="container member-detail">
      <a href="index.html#about" class="back-link">← BACK TO TEAM</a>
      <div class="member-detail-inner">
        <div class="member-photo ${m.avatarClass || ''}">
          <img src="${escapeAttr(m.photo)}" alt="${escapeAttr(m.name)}" />
        </div>
        <div class="member-body">
          <div class="section-label">// ${escapeHtml(m.role || 'TEAM')}</div>
          <h1>${escapeHtml(m.name)}</h1>
          <p class="member-desc">${escapeHtml(m.description || '')}</p>
        </div>
      </div>
      ${BarkEditor.editing ? `
        <div class="member-edit-actions">
          <button class="btn-secondary" onclick="openTeamModal(${teamIdx})">✎ Edit Member</button>
          <button class="btn-ghost danger" onclick="deleteTeam(${teamIdx})">✕ Delete</button>
        </div>
      ` : ''}
    </div>
  `;
}

// ----------------------------------------------------------
//  EDIT CONTROL OVERLAY
// ----------------------------------------------------------
function editControls(kind, index) {
  const editFn = kind === 'team' ? `openTeamModal(${index})`
               : kind === 'game' ? `openGameModal(${index})`
               : `openStoreModal(${index})`;
  const delFn  = kind === 'team' ? `deleteTeam(${index})`
               : kind === 'game' ? `deleteGame(${index})`
               : `deleteStoreItem(${index})`;
  return `
    <div class="edit-overlay" onclick="event.preventDefault(); event.stopPropagation();">
      <button class="edit-btn" onclick="${editFn}">✎ Edit</button>
      <button class="edit-btn edit-btn-danger" onclick="${delFn}">✕</button>
    </div>
  `;
}

// ----------------------------------------------------------
//  RENDER: STORE
// ----------------------------------------------------------
async function renderStore(container) {
  if (!container) return;
  const allItems = (BarkEditor.data.store) || [];
  container.innerHTML = '';

  // Localized currency banner
  const note = document.getElementById('storeCurrencyNote');
  const { currency, rate } = await getLocalCurrency();
  if (note) {
    note.textContent = currency === 'USD'
      ? 'Prices in USD.'
      : `Prices shown in ${currency} (converted from USD at ~${rate.toFixed(2)}).`;
  }

  // Build / refresh filter bar (rendered into a sibling element if present)
  const filterBar = document.getElementById('storeFilterBar');
  if (filterBar) {
    const current = BarkEditor.storeFilter || 'all';
    const counts = {
      all: allItems.length,
      new: allItems.filter(i => i.isNew).length,
      limited: allItems.filter(i => i.isLimited).length,
      instock: allItems.filter(i => !i.soldOut).length,
      soldout: allItems.filter(i => i.soldOut).length,
    };
    filterBar.innerHTML = `
      ${[
        ['all', 'All'],
        ['new', 'New'],
        ['limited', 'Limited'],
        ['instock', 'In Stock'],
        ['soldout', 'Sold Out'],
      ].map(([key, label]) => `
        <button type="button" class="store-filter-btn ${current === key ? 'active' : ''}" data-filter="${key}">
          ${label}<span class="store-filter-count">${counts[key]}</span>
        </button>
      `).join('')}
    `;
    filterBar.querySelectorAll('.store-filter-btn').forEach(btn => {
      btn.onclick = () => {
        BarkEditor.storeFilter = btn.dataset.filter;
        rerenderPage();
      };
    });
  }

  // Apply filter
  const filter = BarkEditor.storeFilter || 'all';
  const items = allItems.filter(it => {
    if (filter === 'new')     return !!it.isNew;
    if (filter === 'limited') return !!it.isLimited;
    if (filter === 'instock') return !it.soldOut;
    if (filter === 'soldout') return !!it.soldOut;
    return true;
  });

  if (allItems.length === 0 && !BarkEditor.editing) {
    container.innerHTML = `
      <div class="store-empty">
        <p class="section-label">// COMING SOON</p>
        <h3>The shelves are empty for now.</h3>
        <p>Check back soon — we're cooking up merch.</p>
      </div>
    `;
  } else if (allItems.length > 0 && items.length === 0) {
    container.innerHTML = `
      <div class="store-empty">
        <h3>No items match this filter.</h3>
        <p>Try a different category.</p>
      </div>
    `;
  }

  items.forEach((it) => {
    const i = allItems.indexOf(it); // editor index in the underlying array
    const soldOut = !!it.soldOut;
    const price = formatLocalPrice(it.priceUSD, currency, rate);

    const card = document.createElement(soldOut ? 'div' : 'a');
    card.className = `store-card ${soldOut ? 'sold-out' : ''}`;
    if (!soldOut) {
      card.href = it.url || '#';
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
    }
    card.innerHTML = `
      <div class="store-card-img-wrap">
        <img src="${escapeAttr(it.image || '')}" alt="${escapeAttr(it.name)}" class="store-card-img" />
        <div class="store-badges">
          ${it.isNew     ? `<span class="badge badge-new">NEW</span>`         : ''}
          ${it.isLimited ? `<span class="badge badge-limited">LIMITED</span>` : ''}
          ${soldOut      ? `<span class="badge badge-soldout">SOLD OUT</span>`: ''}
        </div>
      </div>
      <div class="store-card-body">
        <h3 class="store-card-name">${escapeHtml(it.name)}</h3>
        <p class="store-card-price">${escapeHtml(price)}</p>
      </div>
      ${BarkEditor.editing ? editControls('store', i) : ''}
    `;
    container.appendChild(card);
  });

  if (BarkEditor.editing) {
    const add = document.createElement('button');
    add.className = 'store-card add-card';
    add.type = 'button';
    add.innerHTML = `<div class="add-plus">+</div><div class="add-label">Add Item</div>`;
    add.onclick = () => openStoreModal(null);
    container.appendChild(add);
  }
}

// Synchronous helper since we already have rate
function formatLocalPrice(usd, currency, rate) {
  const amount = Number(usd) || 0;
  const converted = amount * (rate || 1);
  try {
    return new Intl.NumberFormat(navigator.language || 'en-US', {
      style: 'currency',
      currency,
    }).format(converted);
  } catch {
    return `${currency} ${converted.toFixed(2)}`;
  }
}

// ----------------------------------------------------------
//  CURRENCY LOCALIZATION (free API, cached for 12 h)
// ----------------------------------------------------------
const REGION_TO_CURRENCY = {
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', AR: 'ARS',
  GB: 'GBP', IE: 'EUR', FR: 'EUR', DE: 'EUR', ES: 'EUR', IT: 'EUR',
  NL: 'EUR', BE: 'EUR', PT: 'EUR', AT: 'EUR', FI: 'EUR', GR: 'EUR',
  SE: 'SEK', NO: 'NOK', DK: 'DKK', CH: 'CHF', PL: 'PLN', CZ: 'CZK',
  HU: 'HUF', RO: 'RON', BG: 'BGN', UA: 'UAH', RU: 'RUB', TR: 'TRY',
  JP: 'JPY', KR: 'KRW', CN: 'CNY', HK: 'HKD', TW: 'TWD', SG: 'SGD',
  TH: 'THB', VN: 'VND', PH: 'PHP', ID: 'IDR', MY: 'MYR', IN: 'INR',
  PK: 'PKR', BD: 'BDT', AE: 'AED', SA: 'SAR', IL: 'ILS', EG: 'EGP',
  ZA: 'ZAR', NG: 'NGN', KE: 'KES', AU: 'AUD', NZ: 'NZD',
};

async function getLocalCurrency() {
  const region = (navigator.language || 'en-US').split('-')[1] || 'US';
  const currency = REGION_TO_CURRENCY[region.toUpperCase()] || 'USD';
  if (currency === 'USD') return { currency: 'USD', rate: 1 };

  // Cache rates in sessionStorage (12h-ish, but session is fine)
  const cacheKey = 'bark.rates.usd';
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (cached && cached.rates && cached.rates[currency]) {
      return { currency, rate: cached.rates[currency] };
    }
  } catch {}

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) throw new Error('rates fetch failed');
    const j = await res.json();
    if (j && j.rates) {
      sessionStorage.setItem(cacheKey, JSON.stringify({ rates: j.rates, t: Date.now() }));
      return { currency, rate: j.rates[currency] || 1 };
    }
  } catch (e) {
    console.warn('Could not fetch exchange rates, falling back to USD', e);
  }
  return { currency: 'USD', rate: 1 };
}

// ----------------------------------------------------------
//  EXTRAS: SEASON + WEATHER (no overrides, ever)
//  Same algorithm as bark-manager/manager.js, with override
//  handling stripped out so visitors always see the natural
//  rotation.
// ----------------------------------------------------------
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Weekly rotation through non-forceOnly seasons. No overrides.
function computeSeasonAt(ms) {
  const seasons = (BarkEditor.data.seasons || []).filter(s => !s.forceOnly);
  if (!seasons.length) return null;
  return seasons[Math.floor(ms / 604800000) % seasons.length];
}

function getSeasonFilteredTypes(slotMs) {
  const allTypes = (BarkEditor.data.weatherTypes || []).filter(t => !t.forceOnly);
  const season   = computeSeasonAt(slotMs);
  if (!season || !season.allowedWeatherIds || !season.allowedWeatherIds.length) return allTypes;
  const filtered = allTypes.filter(t => season.allowedWeatherIds.includes(t.id));
  return filtered.length ? filtered : allTypes;
}

function pickWeather(types, slotIndex) {
  if (!types.length) return null;
  const rand  = mulberry32(slotIndex);
  const total = types.reduce((s, t) => s + (t.weight || 1), 0);
  let   roll  = rand() * total;
  for (const t of types) { roll -= (t.weight || 1); if (roll <= 0) return t; }
  return types[types.length - 1];
}

function nextWeeklyBoundary(nowMs) {
  return (Math.floor(nowMs / 604800000) + 1) * 604800000;
}
function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

// ----------------------------------------------------------
//  SITE TEXT — inline-editable text overrides
//  Any element with data-text-key="..." can be edited inline
//  when an editor is in Edit Mode. Defaults come from the HTML.
//  Stored in data.siteText[key]. Empty = use the HTML default.
// ----------------------------------------------------------
function getText(key) {
  const stored = BarkEditor.data.siteText && BarkEditor.data.siteText[key];
  return (stored != null && stored !== '') ? stored : null;
}

// Walk the DOM and overwrite [data-text-key] elements with saved overrides.
// Captures the HTML's default on first run so we can restore / list it later.
function applyTextOverrides() {
  document.querySelectorAll('[data-text-key]').forEach(el => {
    const key   = el.dataset.textKey;
    const isHtml = el.dataset.textHtml === '1';
    // remember the default once
    if (el.dataset.defaultText == null) {
      el.dataset.defaultText = isHtml ? el.innerHTML.trim() : el.textContent.trim();
    }
    const override = getText(key);
    const value = override != null ? override : el.dataset.defaultText;
    if (isHtml) el.innerHTML  = value;
    else        el.textContent = value;
  });
  // Wire up inline editing if in edit mode
  if (BarkEditor.editing) enableInlineEditing();
  else                    disableInlineEditing();
}

function enableInlineEditing() {
  document.querySelectorAll('[data-text-key]').forEach(el => {
    if (el.dataset.inlineWired === '1') return;
    el.dataset.inlineWired = '1';
    el.classList.add('inline-editable');
    el.setAttribute('contenteditable', 'plaintext-only');
    el.addEventListener('focus',  onInlineFocus);
    el.addEventListener('blur',   onInlineBlur);
    el.addEventListener('keydown', onInlineKey);
  });
}

function disableInlineEditing() {
  document.querySelectorAll('[data-text-key]').forEach(el => {
    if (el.dataset.inlineWired !== '1') return;
    el.dataset.inlineWired = '0';
    el.classList.remove('inline-editable');
    el.removeAttribute('contenteditable');
    el.removeEventListener('focus',  onInlineFocus);
    el.removeEventListener('blur',   onInlineBlur);
    el.removeEventListener('keydown', onInlineKey);
  });
}

function onInlineFocus(e) {
  e.currentTarget.classList.add('inline-editing');
}
function onInlineBlur(e) {
  const el  = e.currentTarget;
  el.classList.remove('inline-editing');
  const key = el.dataset.textKey;
  const isHtml = el.dataset.textHtml === '1';
  const newVal = (isHtml ? el.innerHTML : el.textContent).trim();
  const def    = (el.dataset.defaultText || '').trim();
  if (!BarkEditor.data.siteText) BarkEditor.data.siteText = {};
  if (newVal === def) {
    delete BarkEditor.data.siteText[key]; // back to default → drop the override
  } else {
    BarkEditor.data.siteText[key] = newVal;
  }
  BarkEditor.dirty = true;
  updateEditorBar();
}
function onInlineKey(e) {
  // Esc cancels, Enter blurs (commits)
  if (e.key === 'Escape') {
    const el = e.currentTarget;
    const key = el.dataset.textKey;
    const isHtml = el.dataset.textHtml === '1';
    const override = getText(key);
    const value = override != null ? override : el.dataset.defaultText;
    if (isHtml) el.innerHTML  = value;
    else        el.textContent = value;
    el.blur();
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    e.currentTarget.blur();
  }
}

function renderExtras() {
  const seasonCard = document.getElementById('seasonCard');
  if (!seasonCard) return; // not on extras page

  const dur     = (BarkEditor.data.slotDuration) || 300;
  const nowMs   = Date.now();
  const slotIdx = Math.floor((nowMs / 1000) / dur);

  // Season
  const season = computeSeasonAt(nowMs);
  const dot    = document.getElementById('seasonDot');
  const name   = document.getElementById('seasonName');
  const sMeta  = document.getElementById('seasonMeta');
  if (season) {
    dot.style.background = season.color;
    dot.style.boxShadow  = `0 0 24px ${season.color}`;
    name.textContent = season.displayName;
    const untilNext = nextWeeklyBoundary(nowMs) - nowMs;
    sMeta.textContent = `Rotates in ${formatDuration(untilNext)}`;
  } else {
    name.textContent = 'No seasons configured';
    sMeta.textContent = '';
  }

  // Current weather
  const types   = getSeasonFilteredTypes(nowMs);
  const weather = pickWeather(types, slotIdx);
  const wInit = document.getElementById('weatherInitial');
  const wName = document.getElementById('weatherName');
  const wInfo = document.getElementById('weatherInfo');
  const wMeta = document.getElementById('weatherMeta');
  if (weather) {
    wInit.textContent = weather.initial || '--';
    wName.textContent = weather.displayName;
    wInfo.textContent = weather.info || '';
    const slotEndMs = (slotIdx + 1) * dur * 1000;
    wMeta.textContent = `Changes in ${formatDuration(slotEndMs - nowMs)}`;
  } else {
    wInit.textContent = '--';
    wName.textContent = 'No weather configured';
    wInfo.textContent = '';
    wMeta.textContent = '';
  }

  // Forecast — next 12 slots
  const row = document.getElementById('forecastRow');
  if (row) {
    const SLOTS_AHEAD = 12;
    row.innerHTML = '';
    for (let i = 1; i <= SLOTS_AHEAD; i++) {
      const si = slotIdx + i;
      const startMs = si * dur * 1000;
      const w = pickWeather(getSeasonFilteredTypes(startMs), si);
      const t = new Date(startMs);
      const timeStr = t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const cell = document.createElement('div');
      cell.className = 'forecast-cell';
      cell.innerHTML = `
        <div class="forecast-time">${timeStr}</div>
        <div class="forecast-initial">${w ? escapeHtml(w.initial) : '--'}</div>
        <div class="forecast-name">${w ? escapeHtml(w.displayName) : ''}</div>
      `;
      row.appendChild(cell);
    }
  }
}

// Keep the extras page ticking once a second so the countdowns are live.
let _extrasTick = null;
function startExtrasTick() {
  if (_extrasTick) clearInterval(_extrasTick);
  if (!document.getElementById('seasonCard')) return;
  _extrasTick = setInterval(renderExtras, 1000);
}

// ─── WOOD TYPES ────────────────────────────────────────────────────────────
let _woodTypes = null;       // static, from wood-types.json
let _woodCounts = null;      // dynamic, from backend /wood-counts
let _woodCountsLastTs = 0;

async function loadWoodTypes() {
  if (_woodTypes) return _woodTypes;
  try {
    const r = await fetch('wood-types.json?t=' + Date.now());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    _woodTypes = j.woodTypes || [];
  } catch (e) {
    console.warn('[wood] Could not load wood-types.json:', e.message);
    _woodTypes = [];
  }
  return _woodTypes;
}

async function loadWoodCounts(force) {
  const now = Date.now();
  if (!force && _woodCounts && (now - _woodCountsLastTs) < 30000) return _woodCounts;
  try {
    if (!BARK_BACKEND_URL) await loadBackendUrl();
    if (!BARK_BACKEND_URL) throw new Error('NO_URL');
    const r = await fetch(`${BARK_BACKEND_URL}/wood-counts`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    _woodCounts = j.counts || {};
    _woodCountsLastTs = now;
  } catch (e) {
    console.warn('[wood] Could not load /wood-counts:', e.message);
    if (!_woodCounts) _woodCounts = {};
  }
  return _woodCounts;
}

const WOOD_RARITIES = [
  { id: '',          label: 'Common (default)' },
  { id: 'uncommon',  label: 'Uncommon — green'    },
  { id: 'epic',      label: 'Epic — purple'       },
  { id: 'legendary', label: 'Legendary — gold'    },
  { id: 'exotic',    label: 'Exotic — sky blue'   },
  { id: 'dangboi',   label: 'DANG BOI — black/grey' },
];

async function renderWoodSection() {
  const grid = document.getElementById('woodGrid');
  if (!grid) return; // not on extras page

  const [types, counts] = await Promise.all([loadWoodTypes(), loadWoodCounts(false)]);

  if (!types.length) {
    grid.innerHTML = `<p class="players-empty">No wood types found. Make sure <code>wood-types.json</code> is in the repo (auto-published by bark-manager).</p>`;
    return;
  }

  const overrides = (BarkEditor.data && BarkEditor.data.woodOverrides) || {};

  // Rarity denominator: only obtainable woods. cannotGet are excluded so the
  // displayed odds reflect what's actually in the rotation.
  const obtainable = types.filter(w => !(overrides[w.woodID] && overrides[w.woodID].cannotGet));
  const totalWeight = obtainable.reduce((s, w) => s + (w.rarityWeight || 1), 0) || 1;

  grid.innerHTML = types.map(w => {
    const ov = overrides[w.woodID] || {};
    const cantGet   = !!ov.cannotGet;
    const isLimited = !!ov.isLimited;
    const rarity    = ov.rarity || '';
    const image     = ov.image || '';
    const players   = counts[w.woodID] || 0;

    let rarityText;
    if (cantGet) {
      rarityText = 'UNOBTAINABLE';
    } else {
      const chance = (w.rarityWeight || 1) / totalWeight;
      const oneInX = Math.round(1 / chance);
      rarityText = `1 in ${oneInX}`;
    }

    const classes = ['wood-card'];
    if (w.isFancyWood) classes.push('wood-card-fancy');
    if (cantGet)       classes.push('wood-card-cantget');
    if (isLimited)     classes.push('wood-card-limited');
    if (rarity)        classes.push('wood-rarity-' + rarity);

    const rarityLabel = WOOD_RARITIES.find(r => r.id === rarity)?.label.split(' — ')[0] || '';

    return `
      <div class="${classes.join(' ')}">
        ${image ? `<div class="wood-card-img-wrap"><img src="${escapeAttr(image)}" alt="${escapeAttr(w.woodID)}" class="wood-card-img" onerror="this.parentElement.style.display='none'" /></div>` : ''}
        <div class="wood-badges">
          ${rarity && rarity !== 'common' ? `<span class="badge badge-rarity">${escapeHtml(rarityLabel.toUpperCase())}</span>` : ''}
          ${isLimited ? `<span class="badge badge-limited">LIMITED</span>` : ''}
          ${cantGet   ? `<span class="badge badge-cantget">UNOBTAINABLE</span>` : ''}
        </div>
        <div class="wood-card-head">
          <h4 class="wood-card-name">${escapeHtml(w.woodID)}${w.isFancyWood ? ' <span class="wood-fancy-star">★</span>' : ''}</h4>
          <span class="wood-card-rarity">${escapeHtml(rarityText)}</span>
        </div>
        <div class="wood-card-count">
          <span class="wood-card-count-num">${players}</span>
          <span class="wood-card-count-label">player${players === 1 ? '' : 's'}</span>
        </div>
        ${BarkEditor.editing ? `
          <div class="edit-overlay" onclick="event.stopPropagation()">
            <button class="edit-btn" onclick="openWoodOverrideModal('${escapeAttr(w.woodID)}')">✎</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function openWoodOverrideModal(woodID) {
  if (!BarkEditor.data.woodOverrides) BarkEditor.data.woodOverrides = {};
  const cur = BarkEditor.data.woodOverrides[woodID] || {};

  showModal(`Wood: ${woodID}`, `
    <p class="modal-hint" style="margin-bottom:14px;">
      Visual-only flags. None of this changes anything in-game — only the website display.
    </p>

    <label>Image (square recommended — gets rounded corners)</label>
    <div class="img-row">
      <img id="modalWoodPreview" src="${escapeAttr(cur.image || '')}" class="img-preview" onerror="this.style.visibility='hidden'" />
      <input type="file" id="modalWoodFile" accept="image/*" />
    </div>

    <label>Rarity</label>
    <select id="modalWoodRarity">
      ${WOOD_RARITIES.map(r => `<option value="${r.id}" ${(cur.rarity || '') === r.id ? 'selected' : ''}>${escapeHtml(r.label)}</option>`).join('')}
    </select>

    <label class="checkbox-row">
      <input type="checkbox" id="modalWoodCantGet" ${cur.cannotGet ? 'checked' : ''} />
      <span><strong>UNOBTAINABLE</strong> — greys it out, "UNOBTAINABLE" badge, excluded from the rarity-odds math</span>
    </label>
    <label class="checkbox-row">
      <input type="checkbox" id="modalWoodLimited" ${cur.isLimited ? 'checked' : ''} />
      <span><strong>LIMITED</strong> — pink "LIMITED" badge</span>
    </label>
  `, async () => {
    const next = { ...cur };
    delete next.cannotGet;
    delete next.isLimited;
    delete next.rarity;
    if (document.getElementById('modalWoodCantGet').checked) next.cannotGet = true;
    if (document.getElementById('modalWoodLimited').checked) next.isLimited = true;
    const r = document.getElementById('modalWoodRarity').value;
    if (r) next.rarity = r;

    const file = document.getElementById('modalWoodFile').files[0];
    if (file) {
      try {
        showSpinner('Uploading wood image...');
        next.image = await uploadImage(file);
      } catch (e) {
        alert('Image upload failed: ' + e.message); hideSpinner(); return false;
      }
      hideSpinner();
    }

    if (Object.keys(next).length === 0) {
      delete BarkEditor.data.woodOverrides[woodID];
    } else {
      BarkEditor.data.woodOverrides[woodID] = next;
    }
    BarkEditor.dirty = true;
    renderWoodSection();
    updateEditorBar();
    return true;
  });

  // file preview
  const f = document.getElementById('modalWoodFile');
  if (f) f.addEventListener('change', e => previewInto('modalWoodPreview', e.target.files[0]));
}

window.openWoodOverrideModal = openWoodOverrideModal;

// Refresh counts periodically while on the extras page
let _woodTick = null;
function startWoodTick() {
  if (_woodTick) clearInterval(_woodTick);
  if (!document.getElementById('woodGrid')) return;
  _woodTick = setInterval(() => { loadWoodCounts(true).then(renderWoodSection); }, 30000);
}

// ----------------------------------------------------------
//  PLAYERS — linked Discord accounts
// ----------------------------------------------------------
const BarkPlayers = {
  list: null,       // array of profiles
  loaded: false,
  loading: false,
  filter: '',
};

function imgSrc(p) {
  if (!p) return '';
  if (p.startsWith('http')) return p;
  return BARK_BACKEND_URL.replace(/\/$/, '') + p;
}

function formatPlaytime(minutes) {
  if (!minutes || isNaN(minutes)) return 'No data yet';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return `${h}h ${m}m`;
}

async function loadPlayers(force) {
  if (BarkPlayers.loading) return;
  BarkPlayers.loading = true;
  const meta = document.getElementById('playersMeta');
  if (meta) meta.textContent = 'Loading from backend…';
  try {
    if (!BARK_BACKEND_URL) await loadBackendUrl();
    if (!BARK_BACKEND_URL) throw new Error('NO_URL_FILE');
    const url = `${BARK_BACKEND_URL}/linked-profiles${force ? '?fresh=1' : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
    const j = await res.json();
    BarkPlayers.list = j.profiles || [];
    BarkPlayers.loaded = true;
  } catch (e) {
    BarkPlayers.list = null;
    if (meta) {
      if (e.message === 'NO_URL_FILE') {
        meta.innerHTML = `Couldn't find <code>backend-url.json</code>. Start the <strong>Cloudflare Tunnel</strong> in bark-manager — it auto-publishes the URL when it starts.`;
      } else {
        meta.innerHTML = `Backend unreachable at <code>${escapeHtml(BARK_BACKEND_URL || '(no URL yet)')}</code>.<br>
          Make sure (1) the backend is running, (2) the tunnel is running, and (3) the URL in <code>backend-url.json</code> matches the tunnel.`;
      }
    }
    console.warn('[players] load failed:', e);
  } finally {
    BarkPlayers.loading = false;
  }
}

function renderPlayers(container) {
  if (!container) return;
  if (!BarkPlayers.loaded) {
    loadPlayers(false).then(() => renderPlayers(container));
    return;
  }
  if (!BarkPlayers.list) return; // load error already shown

  const meta = document.getElementById('playersMeta');
  if (meta) meta.textContent = `${BarkPlayers.list.length} linked player${BarkPlayers.list.length === 1 ? '' : 's'}.`;

  const filter = (BarkPlayers.filter || '').toLowerCase().trim();
  const filtered = !filter ? BarkPlayers.list : BarkPlayers.list.filter(p =>
    (p.displayName || '').toLowerCase().includes(filter) ||
    (p.trelativeName || '').toLowerCase().includes(filter)
  );

  container.innerHTML = '';
  filtered.forEach(p => {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.innerHTML = `
      <div class="player-card-img-wrap">
        ${p.imageUrl
          ? `<img src="${escapeAttr(imgSrc(p.imageUrl))}" alt="${escapeAttr(p.displayName)}" class="player-card-img" onerror="this.style.display='none'" />`
          : `<div class="player-card-img placeholder">${escapeHtml((p.displayName || '?')[0].toUpperCase())}</div>`}
        ${p.moderated && BarkEditor.editing ? `<div class="player-mod-badge" title="Has moderator overrides">MOD</div>` : ''}
      </div>
      <div class="player-card-body">
        <h3 class="player-card-name">${escapeHtml(p.displayName || 'Unknown')}</h3>
        ${p.trelativeName ? `<p class="player-card-sub">${escapeHtml(p.trelativeName)}</p>` : ''}
        ${p.description ? `<p class="player-card-desc">${escapeHtml(p.description)}</p>` : ''}
      </div>
      ${BarkEditor.editing ? `
        <div class="player-mod-actions" onclick="event.stopPropagation()">
          <button type="button" class="edit-btn" onclick="openPlayerModModal('${escapeAttr(p.discordId)}')">⚒ Moderate</button>
        </div>
      ` : ''}
    `;
    card.addEventListener('click', () => openPlayerDetail(p.discordId));
    container.appendChild(card);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<p class="players-empty">No players match "${escapeHtml(filter)}".</p>`;
  }

  // Wire up search + refresh once
  const search = document.getElementById('playerSearch');
  if (search && !search.dataset.wired) {
    search.dataset.wired = '1';
    search.addEventListener('input', () => {
      BarkPlayers.filter = search.value;
      renderPlayers(container);
    });
  }
  const refresh = document.getElementById('playersRefresh');
  if (refresh && !refresh.dataset.wired) {
    refresh.dataset.wired = '1';
    refresh.onclick = async () => {
      refresh.disabled = true;
      refresh.textContent = '↻ Refreshing…';
      await loadPlayers(true);
      refresh.disabled = false;
      refresh.textContent = '↻ Refresh';
      renderPlayers(container);
    };
  }
}

function openPlayerDetail(discordId) {
  const p = (BarkPlayers.list || []).find(x => x.discordId === discordId);
  const grid   = document.querySelector('.players-page-target');
  const target = document.getElementById('playerDetailTarget');
  if (!p || !target) return;

  document.title = `${p.displayName} | BARKVR`;
  if (grid) grid.style.display = 'none';
  document.querySelector('.players-toolbar')?.style.setProperty('display', 'none');
  target.style.display = 'block';

  const items = (p.items || []);
  target.innerHTML = `
    <a href="#" class="back-link" id="playersBack">← BACK TO PLAYERS</a>
    <div class="player-detail">
      <div class="player-detail-head">
        ${p.imageUrl
          ? `<img src="${escapeAttr(imgSrc(p.imageUrl))}" alt="${escapeAttr(p.displayName)}" class="player-detail-img" />`
          : `<div class="player-detail-img placeholder">${escapeHtml((p.displayName || '?')[0].toUpperCase())}</div>`}
        <div>
          <div class="section-label">// PLAYER</div>
          <h1>${escapeHtml(p.displayName)}</h1>
          ${p.trelativeName ? `<p class="player-detail-tre">🪪 ${escapeHtml(p.trelativeName)}</p>` : ''}
          ${p.description ? `<p class="player-detail-desc">${escapeHtml(p.description)}</p>` : ''}
        </div>
      </div>

      <div class="player-stats">
        <div class="player-stat"><div class="stat-label">PAPER COINS</div><div class="stat-value">${p.coins ?? '—'}</div></div>
        <div class="player-stat"><div class="stat-label">ARCADE TOKENS</div><div class="stat-value">${p.arcadeTokens ?? '—'}</div></div>
        <div class="player-stat"><div class="stat-label">WOOD</div><div class="stat-value">${escapeHtml(p.woodID || '—')}</div></div>
        <div class="player-stat"><div class="stat-label">PLAYTIME</div><div class="stat-value">${escapeHtml(formatPlaytime(p.minutesPlayed))}</div></div>
      </div>

      <div class="player-items">
        <div class="section-label">// INVENTORY (${p.itemCount || 0})</div>
        ${items.length
          ? `<div class="player-items-grid">${items.map(it => `
              <div class="player-item">
                <span class="player-item-name">${escapeHtml(it.name)}</span>
                ${it.count > 1 ? `<span class="player-item-count">×${it.count}</span>` : ''}
              </div>
            `).join('')}</div>`
          : `<p class="players-empty">No items yet.</p>`}
      </div>

      ${BarkEditor.editing ? `
        <div class="member-edit-actions">
          <button class="btn-secondary" onclick="openPlayerModModal('${escapeAttr(p.discordId)}')">⚒ Moderate this account</button>
        </div>
      ` : ''}
    </div>
  `;
  document.getElementById('playersBack').onclick = (e) => {
    e.preventDefault();
    closePlayerDetail();
  };
  applyTextOverrides();
}

function closePlayerDetail() {
  const grid    = document.querySelector('.players-page-target');
  const tools   = document.querySelector('.players-toolbar');
  const target  = document.getElementById('playerDetailTarget');
  if (grid)   grid.style.display = '';
  if (tools)  tools.style.display = '';
  if (target) { target.style.display = 'none'; target.innerHTML = ''; }
  document.title = 'Players | BARKVR';
}

// ─── Moderation modal (editor only) ────────────────────────────────────────
function getModSecret() {
  let s = localStorage.getItem('bark.modSecret');
  if (!s) {
    s = prompt(
      'Paste the backend moderation secret (WEATHER_SECRET in your bark-link-backend .env).\n\n' +
      'It is stored only in this browser.'
    );
    if (s) localStorage.setItem('bark.modSecret', s.trim());
  }
  return s;
}

function openPlayerModModal(discordId) {
  const p = (BarkPlayers.list || []).find(x => x.discordId === discordId);
  if (!p) return;

  showModal(`Moderate: ${p.displayName}`, `
    <p class="modal-hint" style="margin-bottom:14px;">
      All actions write to the backend immediately. They do NOT need a "Save & Publish".
    </p>

    <label>Override displayed name (leave blank to keep player's chosen name)</label>
    <input id="modPlayerName" value="${escapeAttr(p.displayName || '')}" />

    <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px;">
      <button type="button" class="btn-secondary" id="modClearImage">${p.imageUrl ? '🚫 Remove their profile image' : '✓ (no image)'}</button>
      <button type="button" class="btn-secondary" id="modHide">🙈 Hide this player from the site</button>
      <button type="button" class="btn-secondary danger" id="modRemove">⚠ Remove the account link entirely</button>
    </div>
  `, async () => {
    // Save name override (only on submit)
    const newName = (document.getElementById('modPlayerName').value || '').trim();
    if (newName && newName !== p.displayName) {
      await callMod(discordId, 'set-name', newName);
    } else if (!newName) {
      await callMod(discordId, 'clear-name');
    }
    await loadPlayers(true);
    renderPlayers(document.querySelector('.players-page-target'));
    return true;
  });

  document.getElementById('modClearImage').onclick = async () => {
    if (!p.imageUrl) return;
    if (!confirm('Remove this player\'s profile image from the site?')) return;
    await callMod(discordId, 'clear-image');
    await loadPlayers(true);
    renderPlayers(document.querySelector('.players-page-target'));
    document.querySelector('.bark-modal-close').click();
  };
  document.getElementById('modHide').onclick = async () => {
    if (!confirm('Hide this player from the website? Their data stays on the backend; you can unhide later via the backend.')) return;
    await callMod(discordId, 'hide');
    await loadPlayers(true);
    renderPlayers(document.querySelector('.players-page-target'));
    document.querySelector('.bark-modal-close').click();
  };
  document.getElementById('modRemove').onclick = async () => {
    if (!confirm('REMOVE the Discord ↔ PlayFab link entirely?\n\nThis cannot be undone from the website. The player would need to /barklink again with a new code.')) return;
    await callMod(discordId, 'remove-link');
    await loadPlayers(true);
    renderPlayers(document.querySelector('.players-page-target'));
    document.querySelector('.bark-modal-close').click();
  };
}

async function callMod(discordId, action, value) {
  const secret = getModSecret();
  if (!secret) return;
  try {
    const res = await fetch(`${BARK_BACKEND_URL}/mod-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discordId, action, value, secret }),
    });
    const j = await res.json();
    if (!j.success) {
      if (j.message === 'Unauthorized') {
        localStorage.removeItem('bark.modSecret');
        alert('Wrong secret. Cleared — try again.');
      } else {
        alert('Action failed: ' + (j.message || res.status));
      }
    }
    return j;
  } catch (e) {
    alert('Backend unreachable: ' + e.message);
  }
}

window.openPlayerModModal = openPlayerModModal;

// ----------------------------------------------------------
//  DATABASE / INDEX (items, cosmetics, maps, npcs)
// ----------------------------------------------------------
const DB_CATEGORIES = ['items', 'cosmetics', 'maps', 'npcs'];

const BarkDB = {
  activeTab: 'items',
  filter: '',
};

function renderDatabase() {
  const grid = document.querySelector('.db-target');
  if (!grid) return; // not on database page

  // Make sure data has the structure
  if (!BarkEditor.data.database) BarkEditor.data.database = { items: [], cosmetics: [], maps: [], npcs: [] };
  for (const c of DB_CATEGORIES) {
    if (!Array.isArray(BarkEditor.data.database[c])) BarkEditor.data.database[c] = [];
  }

  // Tabs
  const tabs = document.querySelectorAll('.db-tab');
  tabs.forEach(t => {
    t.classList.toggle('active', t.dataset.tab === BarkDB.activeTab);
    if (!t.dataset.wired) {
      t.dataset.wired = '1';
      t.onclick = () => {
        BarkDB.activeTab = t.dataset.tab;
        renderDatabase();
      };
    }
  });

  // Search box
  const search = document.getElementById('dbSearch');
  if (search && !search.dataset.wired) {
    search.dataset.wired = '1';
    search.addEventListener('input', () => {
      BarkDB.filter = search.value;
      renderDatabase();
    });
  }

  const entries = BarkEditor.data.database[BarkDB.activeTab] || [];
  const filter  = (BarkDB.filter || '').toLowerCase().trim();
  const filtered = !filter ? entries : entries.filter(e =>
    (e.name || '').toLowerCase().includes(filter) ||
    (e.description || '').toLowerCase().includes(filter) ||
    (e.effect || '').toLowerCase().includes(filter)
  );

  grid.innerHTML = '';

  filtered.forEach(entry => {
    const realIdx = entries.indexOf(entry);
    const card = document.createElement('div');
    card.className = 'db-card';
    card.innerHTML = `
      <div class="db-card-img-wrap">
        ${entry.image
          ? `<img src="${escapeAttr(entry.image)}" alt="${escapeAttr(entry.name)}" class="db-card-img" onerror="this.style.display='none'" />`
          : `<div class="db-card-img placeholder">${escapeHtml((entry.name || '?')[0].toUpperCase())}</div>`}
      </div>
      <div class="db-card-body">
        <h3 class="db-card-name">${escapeHtml(entry.name || 'Untitled')}</h3>
        ${entry.description ? `<p class="db-card-desc">${escapeHtml(entry.description)}</p>` : ''}
      </div>
      ${BarkEditor.editing ? `
        <div class="edit-overlay" onclick="event.stopPropagation()">
          <button class="edit-btn" onclick="openDbEntryModal('${BarkDB.activeTab}', ${realIdx})">✎</button>
          <button class="edit-btn edit-btn-danger" onclick="deleteDbEntry('${BarkDB.activeTab}', ${realIdx})">✕</button>
        </div>
      ` : ''}
    `;
    card.addEventListener('click', () => openDbEntryDetail(BarkDB.activeTab, realIdx));
    grid.appendChild(card);
  });

  if (filtered.length === 0 && !BarkEditor.editing) {
    grid.innerHTML = `<p class="players-empty">Nothing here yet.</p>`;
  }

  if (BarkEditor.editing) {
    const add = document.createElement('button');
    add.className = 'db-card add-card';
    add.type = 'button';
    add.innerHTML = `<div class="add-plus">+</div><div class="add-label">Add ${BarkDB.activeTab.replace(/s$/, '')}</div>`;
    add.onclick = () => openDbEntryModal(BarkDB.activeTab, null);
    grid.appendChild(add);
  }
}

function openDbEntryDetail(cat, idx) {
  const e = BarkEditor.data.database[cat][idx];
  if (!e) return;
  const isItem = cat === 'items';

  showModal(e.name || 'Untitled', `
    ${e.image ? `<img src="${escapeAttr(e.image)}" class="db-detail-img" />` : ''}
    ${e.description ? `<p class="db-detail-desc">${escapeHtml(e.description)}</p>` : ''}
    ${isItem && e.effect ? `
      <div class="db-detail-effect">
        <div class="section-label" style="margin-top:18px;">// WHAT IT DOES</div>
        <p>${escapeHtml(e.effect)}</p>
      </div>` : ''}
    ${BarkEditor.editing ? `
      <div class="member-edit-actions" style="margin-top:24px;">
        <button class="btn-secondary" onclick="document.querySelector('.bark-modal-close').click(); openDbEntryModal('${cat}', ${idx});">✎ Edit</button>
      </div>` : ''}
  `, async () => true);

  // remove the Save button — this is read-only
  const foot = document.querySelector('#barkModal .bark-modal-foot');
  if (foot) foot.querySelector('#modalSave').style.display = 'none';
}

function openDbEntryModal(cat, idx) {
  if (!BarkEditor.data.database) BarkEditor.data.database = {};
  if (!Array.isArray(BarkEditor.data.database[cat])) BarkEditor.data.database[cat] = [];

  const isNew = idx === null || idx === undefined;
  const e = isNew ? { id: '', name: '', description: '', effect: '', image: '' }
                  : { ...BarkEditor.data.database[cat][idx] };
  const isItem = cat === 'items';
  const single = cat.replace(/s$/, '');

  showModal(`${isNew ? 'Add' : 'Edit'} ${single}`, `
    <label>Image (square recommended)</label>
    <div class="img-row">
      <img id="modalDbImgPreview" src="${escapeAttr(e.image || '')}" class="img-preview" onerror="this.style.visibility='hidden'" />
      <input type="file" id="modalDbImgFile" accept="image/*" />
    </div>

    <label>Name</label>
    <input id="modalDbName" value="${escapeAttr(e.name)}" placeholder="e.g. Acorn" />

    <label>Description</label>
    <textarea id="modalDbDesc" rows="3">${escapeHtml(e.description || '')}</textarea>

    ${isItem ? `
      <label>What it does</label>
      <textarea id="modalDbEffect" rows="3" placeholder="e.g. Heals 50% HP, drops a Wood ID, etc.">${escapeHtml(e.effect || '')}</textarea>
    ` : ''}

    <label>URL slug (optional — auto-generated from name if blank)</label>
    <input id="modalDbId" value="${escapeAttr(e.id)}" />
  `, async () => {
    const next = {
      id: (document.getElementById('modalDbId').value.trim() || slugify(document.getElementById('modalDbName').value)),
      name: document.getElementById('modalDbName').value.trim(),
      description: document.getElementById('modalDbDesc').value.trim(),
      image: e.image || '',
    };
    if (!next.name) { alert('Name required'); return false; }
    if (isItem) next.effect = document.getElementById('modalDbEffect').value.trim();

    const file = document.getElementById('modalDbImgFile').files[0];
    if (file) {
      try {
        showSpinner('Uploading image...');
        next.image = await uploadImage(file);
      } catch (err) {
        alert('Image upload failed: ' + err.message); hideSpinner(); return false;
      }
      hideSpinner();
    }

    if (isNew) BarkEditor.data.database[cat].push(next);
    else       BarkEditor.data.database[cat][idx] = next;
    BarkEditor.dirty = true;
    renderDatabase();
    updateEditorBar();
    return true;
  });

  const f = document.getElementById('modalDbImgFile');
  if (f) f.addEventListener('change', ev => previewInto('modalDbImgPreview', ev.target.files[0]));
}

function deleteDbEntry(cat, idx) {
  const e = BarkEditor.data.database[cat][idx];
  if (!confirm(`Delete "${e.name || 'this entry'}"?`)) return;
  BarkEditor.data.database[cat].splice(idx, 1);
  BarkEditor.dirty = true;
  renderDatabase();
  updateEditorBar();
}

window.openDbEntryModal = openDbEntryModal;
window.openDbEntryDetail = openDbEntryDetail;
window.deleteDbEntry = deleteDbEntry;

// ----------------------------------------------------------
//  RE-RENDER EVERYTHING ON CURRENT PAGE
// ----------------------------------------------------------
function rerenderPage() {
  renderTeam(document.querySelector('.team-grid'));
  renderGamesTeaser(document.querySelector('.games-teaser-target'));
  renderGamesPage(document.querySelector('.games-page-target'));
  renderTeamMember(document.querySelector('.team-member-target'));
  renderStore(document.querySelector('.store-page-target'));
  renderPlayers(document.querySelector('.players-page-target'));
  renderExtras();
  startExtrasTick();
  renderWoodSection();
  startWoodTick();
  renderDatabase();
  applyTextOverrides();
  updateEditorBar();
}

// ----------------------------------------------------------
//  EDITOR BAR
// ----------------------------------------------------------
function shouldShowEditorBar() {
  // Show the bar if (a) user has signed in before, or (b) ?edit is in the URL.
  if (BarkEditor.user) return true;
  const params = new URLSearchParams(location.search);
  return params.has('edit');
}

function buildEditorBar() {
  if (document.getElementById('editorBar')) return;
  if (!shouldShowEditorBar()) return;
  const bar = document.createElement('div');
  bar.id = 'editorBar';
  bar.className = 'editor-bar';
  bar.innerHTML = `
    <div class="editor-bar-inner">
      <div class="editor-status">
        <span class="editor-dot"></span>
        <span id="editorStatusText">Signed out</span>
      </div>
      <div class="editor-actions" id="editorActions">
        <button class="btn-primary editor-signin-btn" id="signInBtn">Sign in with Google</button>
      </div>
    </div>
  `;
  document.body.appendChild(bar);
  document.body.classList.add('has-editor-bar');
  document.getElementById('signInBtn').onclick = startSignIn;
}

function updateEditorBar() {
  const bar = document.getElementById('editorBar');
  if (!bar) return;
  const txt = document.getElementById('editorStatusText');
  const actions = document.getElementById('editorActions');

  if (!BarkEditor.user) {
    txt.textContent = 'Editor — Sign in to edit';
    actions.innerHTML = `<button class="btn-primary editor-signin-btn" id="signInBtn">Sign in with Google</button>`;
    document.getElementById('signInBtn').onclick = startSignIn;
    return;
  }

  if (!isAllowed(BarkEditor.user.email)) {
    txt.textContent = `Signed in as ${BarkEditor.user.email} — not authorized`;
    actions.innerHTML = `<button class="btn-ghost" id="signOutBtn">Sign out</button>`;
    document.getElementById('signOutBtn').onclick = signOut;
    return;
  }

  txt.innerHTML = `<strong>${escapeHtml(BarkEditor.user.email)}</strong> ${BarkEditor.editing ? '· EDITING' : '· viewing'}${BarkEditor.dirty ? ' · <em>unsaved</em>' : ''}`;
  actions.innerHTML = `
    <button class="btn-secondary" id="toggleEditBtn">${BarkEditor.editing ? 'Stop Editing' : '✎ Edit Mode'}</button>
    ${BarkEditor.editing ? `<button class="btn-ghost" id="siteTextBtn">📝 Site Text</button>` : ''}
    ${BarkEditor.dirty ? `<button class="btn-primary" id="saveBtn">💾 Save & Publish</button>` : ''}
    <button class="btn-ghost" id="signOutBtn">Sign out</button>
  `;
  document.getElementById('toggleEditBtn').onclick = toggleEdit;
  document.getElementById('signOutBtn').onclick = signOut;
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.onclick = saveToGitHub;
  const siteTextBtn = document.getElementById('siteTextBtn');
  if (siteTextBtn) siteTextBtn.onclick = openSiteTextModal;
}

// ----------------------------------------------------------
//  MODAL — SITE TEXT (edit any text label on the site)
// ----------------------------------------------------------
function openSiteTextModal() {
  if (!BarkEditor.data.siteText) BarkEditor.data.siteText = {};
  const current = BarkEditor.data.siteText;

  // Auto-discover every editable text on this page
  const fields = [];
  document.querySelectorAll('[data-text-key]').forEach(el => {
    const key = el.dataset.textKey;
    if (fields.find(f => f.key === key)) return; // dedupe
    const def = el.dataset.defaultText || el.textContent.trim();
    const longish = def.length > 60 || el.dataset.textHtml === '1';
    fields.push({ key, label: prettifyKey(key), default: def, multiline: longish });
  });
  fields.sort((a, b) => a.label.localeCompare(b.label));

  if (!fields.length) {
    alert('No editable text on this page. You can also click any text in Edit Mode to change it directly.');
    return;
  }

  const body = `
    <p class="modal-hint" style="margin-bottom:14px;">
      Tip: you can also click any text on the page while in Edit Mode to change it directly.
    </p>
    ${fields.map((f, i) => `
      <label>${escapeHtml(f.label)}</label>
      ${f.multiline
        ? `<textarea id="siteText_${i}" rows="3">${escapeHtml(current[f.key] != null ? current[f.key] : f.default)}</textarea>`
        : `<input id="siteText_${i}" value="${escapeAttr(current[f.key] != null ? current[f.key] : f.default)}" />`}
      <p class="modal-hint">Default: ${escapeHtml(f.default)}</p>
    `).join('')}
  `;

  showModal('Edit Site Text', body, async () => {
    fields.forEach((f, i) => {
      const v = (document.getElementById('siteText_' + i).value || '').trim();
      if (!v || v === f.default) delete BarkEditor.data.siteText[f.key];
      else                        BarkEditor.data.siteText[f.key] = v;
    });
    BarkEditor.dirty = true;
    rerenderPage();
    return true;
  });
}

function prettifyKey(key) {
  return key
    .replace(/[._-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());
}

window.openSiteTextModal = openSiteTextModal;

function toggleEdit() {
  BarkEditor.editing = !BarkEditor.editing;
  document.body.classList.toggle('editing', BarkEditor.editing);
  localStorage.setItem('bark.editing', BarkEditor.editing ? '1' : '0');
  rerenderPage();
}

// ----------------------------------------------------------
//  GOOGLE SIGN-IN
// ----------------------------------------------------------
function startSignIn() {
  if (GOOGLE_CLIENT_ID.startsWith('PASTE_YOUR_')) {
    alert('Google Client ID not set yet.\n\nOpen editor.js and follow the SETUP comment at the top to create one (5 min).');
    return;
  }
  if (!window.google || !google.accounts || !google.accounts.id) {
    alert('Google Sign-In script did not load. Check your internet, then refresh.');
    return;
  }
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: onGoogleCredential,
    auto_select: false,
  });
  google.accounts.id.prompt(); // shows the One Tap / chooser
}

function onGoogleCredential(response) {
  try {
    const payload = decodeJwt(response.credential);
    BarkEditor.user = {
      email: (payload.email || '').toLowerCase(),
      name: payload.name || '',
      picture: payload.picture || '',
    };
    localStorage.setItem('bark.user', JSON.stringify(BarkEditor.user));
    if (!isAllowed(BarkEditor.user.email)) {
      alert(`${BarkEditor.user.email} isn't on the editor list. Ask Porter to add you.`);
    }
    updateEditorBar();
  } catch (e) {
    console.error('JWT decode failed', e);
    alert('Sign-in failed.');
  }
}

function signOut() {
  BarkEditor.user = null;
  BarkEditor.editing = false;
  document.body.classList.remove('editing');
  localStorage.removeItem('bark.user');
  localStorage.removeItem('bark.editing');
  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.disableAutoSelect();
  }
  rerenderPage();
}

function isAllowed(email) {
  return ALLOWED_EMAILS.map(e => e.toLowerCase()).includes((email || '').toLowerCase());
}

function decodeJwt(jwt) {
  const part = jwt.split('.')[1];
  const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(decodeURIComponent(escape(json)));
}

// ----------------------------------------------------------
//  GITHUB API — save data.json + upload images
// ----------------------------------------------------------
function getPat() {
  let pat = localStorage.getItem('bark.pat');
  if (!pat) {
    pat = prompt(
      'Paste your GitHub Personal Access Token.\n\n' +
      'Create one at: github.com/settings/personal-access-tokens/new\n' +
      '  Owner: ' + REPO_OWNER + '\n' +
      '  Repo:  only "' + REPO_NAME + '"\n' +
      '  Permissions: Contents -> Read and write\n\n' +
      'It is stored in this browser only.'
    );
    if (pat) localStorage.setItem('bark.pat', pat.trim());
  }
  return pat;
}

function clearPat() {
  localStorage.removeItem('bark.pat');
  alert('GitHub token cleared.');
}

async function ghApi(path, options = {}) {
  const pat = getPat();
  if (!pat) throw new Error('No GitHub token');
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${pat}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status}: ${text}`);
  }
  return res.json();
}

async function fetchFileSha(path) {
  try {
    const j = await ghApi(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(path)}?ref=${REPO_BRANCH}`);
    return j.sha;
  } catch (e) {
    return null; // file doesn't exist yet
  }
}

async function uploadFile(path, base64Content, message) {
  const sha = await fetchFileSha(path);
  return ghApi(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: base64Content,
      branch: REPO_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
}

async function saveToGitHub() {
  if (!confirm('Save changes and push to GitHub?\n\nThis will go live on bark-vr.com within ~1 minute.')) return;

  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

  try {
    const json = JSON.stringify(BarkEditor.data, null, 2);
    const b64 = utf8ToBase64(json);
    const sha = BarkEditor.dataSha || await fetchFileSha(DATA_PATH);
    const result = await ghApi(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Edit content via editor (${BarkEditor.user.email})`,
        content: b64,
        branch: REPO_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });
    BarkEditor.dataSha = result.content.sha;
    BarkEditor.dirty = false;
    updateEditorBar();
    alert('Saved! 🎉\nGitHub Pages usually updates within ~60s.');
  } catch (e) {
    console.error(e);
    alert('Save failed:\n\n' + e.message + '\n\nIf this says "Bad credentials", click Sign out then back in, and you\'ll be re-prompted for the token.');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Save & Publish'; }
  }
}

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

// Read a File as base64 (no data:... prefix), for GitHub uploads
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result; // data:...;base64,xxxx
      const idx = result.indexOf(',');
      resolve(result.slice(idx + 1));
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Upload an image picked from a file input. Returns the path/URL to use in data.
async function uploadImage(file) {
  if (!file) return null;
  const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const path = `${MEDIA_DIR}/${safeName}`;
  const b64 = await fileToBase64(file);
  await uploadFile(path, b64, `Upload ${safeName} via editor`);
  return path; // becomes the src="..." in the site
}

// ----------------------------------------------------------
//  MODALS — TEAM MEMBER
// ----------------------------------------------------------
function openTeamModal(index) {
  const isNew = index === null || index === undefined;
  const m = isNew
    ? { id: '', name: '', role: '', photo: '', avatarClass: '', description: '' }
    : { ...BarkEditor.data.team[index] };

  showModal(`${isNew ? 'Add' : 'Edit'} Team Member`, `
    <label>Photo</label>
    <div class="img-row">
      <img id="modalPhotoPreview" src="${escapeAttr(m.photo || '')}" class="img-preview" onerror="this.style.visibility='hidden'" />
      <input type="file" id="modalPhotoFile" accept="image/*" />
    </div>
    <p class="modal-hint">Picks a new image and uploads it to the repo when you Save.</p>

    <label>Name</label>
    <input id="modalName" value="${escapeAttr(m.name)}" />

    <label>Role</label>
    <input id="modalRole" value="${escapeAttr(m.role)}" placeholder="Developer, Artist, etc." />

    <label>Description (shown on their detail page)</label>
    <textarea id="modalDesc" rows="4">${escapeHtml(m.description || '')}</textarea>

    <label>URL slug (lowercase, no spaces — used in the link)</label>
    <input id="modalId" value="${escapeAttr(m.id)}" placeholder="e.g. mrfish" />
  `, async () => {
    const updated = {
      id: (document.getElementById('modalId').value.trim() || slugify(document.getElementById('modalName').value)),
      name: document.getElementById('modalName').value.trim(),
      role: document.getElementById('modalRole').value.trim(),
      description: document.getElementById('modalDesc').value.trim(),
      avatarClass: m.avatarClass || '',
      photo: m.photo || '',
    };
    if (!updated.name) { alert('Name required'); return false; }

    const file = document.getElementById('modalPhotoFile').files[0];
    if (file) {
      try {
        showSpinner('Uploading photo...');
        updated.photo = await uploadImage(file);
      } catch (e) {
        alert('Image upload failed: ' + e.message); hideSpinner(); return false;
      }
      hideSpinner();
    }

    if (isNew) BarkEditor.data.team.push(updated);
    else      BarkEditor.data.team[index] = updated;
    BarkEditor.dirty = true;
    rerenderPage();
    return true;
  });
}

function deleteTeam(index) {
  const m = BarkEditor.data.team[index];
  if (!confirm(`Delete team member "${m.name}"?`)) return;
  BarkEditor.data.team.splice(index, 1);
  BarkEditor.dirty = true;
  if (location.pathname.endsWith('team.html')) {
    location.href = 'index.html#about';
  } else {
    rerenderPage();
  }
}

// ----------------------------------------------------------
//  MODALS — GAME
// ----------------------------------------------------------
function openGameModal(index) {
  const isNew = index === null || index === undefined;
  const g = isNew
    ? { id: '', name: '', tag: '', tagline: '', shortDesc: '', fullDesc: '', downloadUrl: '', downloadLabel: 'STORE', screenshot: '', morePlatforms: '', reviews: [] }
    : { ...BarkEditor.data.games[index], reviews: [...(BarkEditor.data.games[index].reviews || [])] };

  const reviewsHtml = (g.reviews || []).map((r, i) => reviewEditorRow(r, i)).join('');

  showModal(`${isNew ? 'Add' : 'Edit'} Game`, `
    <label>Name</label>
    <input id="modalName" value="${escapeAttr(g.name)}" placeholder="BARK" />

    <label>Tag (small uppercase badge)</label>
    <input id="modalTag" value="${escapeAttr(g.tag)}" placeholder="VR · SOCIAL · FREE" />

    <label>Tagline (under the title)</label>
    <input id="modalTagline" value="${escapeAttr(g.tagline)}" placeholder="ONE BIG MAP, ONE SMALL COMMUNITY" />

    <label>Short description (home page)</label>
    <textarea id="modalShortDesc" rows="3">${escapeHtml(g.shortDesc || '')}</textarea>

    <label>Full description (games page)</label>
    <textarea id="modalFullDesc" rows="4">${escapeHtml(g.fullDesc || '')}</textarea>

    <label>Download / store URL</label>
    <input id="modalUrl" value="${escapeAttr(g.downloadUrl)}" placeholder="https://www.meta.com/experiences/..." />

    <label>Store label (e.g. META QUEST, STEAM)</label>
    <input id="modalLabel" value="${escapeAttr(g.downloadLabel)}" placeholder="META QUEST" />

    <label>"More platforms" line</label>
    <input id="modalMore" value="${escapeAttr(g.morePlatforms || '')}" placeholder="More platforms coming soon..." />

    <label>Main screenshot</label>
    <div class="img-row">
      <img id="modalShotPreview" src="${escapeAttr(g.screenshot || '')}" class="img-preview wide" onerror="this.style.visibility='hidden'" />
      <input type="file" id="modalShotFile" accept="image/*" />
    </div>

    <label style="margin-top:18px;">Reviews</label>
    <div id="reviewsList">${reviewsHtml}</div>
    <button type="button" class="btn-ghost add-review-btn" id="addReviewBtn">+ Add Review</button>

    <label style="margin-top:18px;">URL slug</label>
    <input id="modalId" value="${escapeAttr(g.id)}" placeholder="e.g. bark" />
  `, async () => {
    const updated = {
      id: (document.getElementById('modalId').value.trim() || slugify(document.getElementById('modalName').value)),
      name: document.getElementById('modalName').value.trim(),
      tag: document.getElementById('modalTag').value.trim(),
      tagline: document.getElementById('modalTagline').value.trim(),
      shortDesc: document.getElementById('modalShortDesc').value.trim(),
      fullDesc: document.getElementById('modalFullDesc').value.trim(),
      downloadUrl: document.getElementById('modalUrl').value.trim(),
      downloadLabel: document.getElementById('modalLabel').value.trim(),
      morePlatforms: document.getElementById('modalMore').value.trim(),
      screenshot: g.screenshot || '',
      reviews: collectReviews(),
    };
    if (!updated.name) { alert('Name required'); return false; }

    const file = document.getElementById('modalShotFile').files[0];
    if (file) {
      try {
        showSpinner('Uploading screenshot...');
        updated.screenshot = await uploadImage(file);
      } catch (e) {
        alert('Image upload failed: ' + e.message); hideSpinner(); return false;
      }
      hideSpinner();
    }

    if (isNew) BarkEditor.data.games.push(updated);
    else      BarkEditor.data.games[index] = updated;
    BarkEditor.dirty = true;
    rerenderPage();
    return true;
  }, () => {
    // wire up the "add review" button after the modal mounts
    const addBtn = document.getElementById('addReviewBtn');
    if (addBtn) addBtn.onclick = () => {
      const wrap = document.createElement('div');
      wrap.innerHTML = reviewEditorRow({ stars: 5, author: '', text: '' }, document.querySelectorAll('.review-edit-row').length);
      document.getElementById('reviewsList').appendChild(wrap.firstElementChild);
    };
    document.getElementById('reviewsList').addEventListener('click', (e) => {
      if (e.target.classList.contains('remove-review-btn')) {
        e.target.closest('.review-edit-row').remove();
      }
    });
  });
}

function reviewEditorRow(r, i) {
  return `
    <div class="review-edit-row">
      <select class="review-stars-input">
        ${[5,4,3,2,1].map(n => `<option value="${n}" ${n === (r.stars || 5) ? 'selected' : ''}>${'★'.repeat(n)}${'☆'.repeat(5-n)}</option>`).join('')}
      </select>
      <input class="review-author-input" value="${escapeAttr(r.author || '')}" placeholder="Username" />
      <input class="review-text-input" value="${escapeAttr(r.text || '')}" placeholder="Review text" />
      <button type="button" class="remove-review-btn" title="Remove">✕</button>
    </div>
  `;
}

function collectReviews() {
  return Array.from(document.querySelectorAll('.review-edit-row')).map(row => ({
    stars: parseInt(row.querySelector('.review-stars-input').value, 10) || 5,
    author: row.querySelector('.review-author-input').value.trim(),
    text: row.querySelector('.review-text-input').value.trim(),
  })).filter(r => r.author || r.text);
}

function deleteGame(index) {
  const g = BarkEditor.data.games[index];
  if (!confirm(`Delete game "${g.name}"?`)) return;
  BarkEditor.data.games.splice(index, 1);
  BarkEditor.dirty = true;
  rerenderPage();
}

// ----------------------------------------------------------
//  MODALS — STORE ITEM
// ----------------------------------------------------------
function openStoreModal(index) {
  if (!BarkEditor.data.store) BarkEditor.data.store = [];
  const isCreating = index === null || index === undefined;
  const it = isCreating
    ? { id: '', name: '', priceUSD: 0, image: '', url: '', soldOut: false, isNew: true, isLimited: false }
    : { ...BarkEditor.data.store[index] };

  showModal(`${isCreating ? 'Add' : 'Edit'} Store Item`, `
    <label>Item image</label>
    <div class="img-row">
      <img id="modalItemPreview" src="${escapeAttr(it.image || '')}" class="img-preview" onerror="this.style.visibility='hidden'" />
      <input type="file" id="modalItemFile" accept="image/*" />
    </div>

    <label>Name</label>
    <input id="modalItemName" value="${escapeAttr(it.name)}" placeholder="BARK T-Shirt" />

    <label>Price (USD) — auto-converts to visitor's currency</label>
    <input id="modalItemPrice" type="number" step="0.01" min="0" value="${Number(it.priceUSD) || 0}" placeholder="19.99" />

    <label>Click-through URL (where buyers go)</label>
    <input id="modalItemUrl" value="${escapeAttr(it.url || '')}" placeholder="https://your-store.com/product/..." />

    <label>Tags / Status</label>
    <label class="checkbox-row">
      <input type="checkbox" id="modalItemNew" ${it.isNew ? 'checked' : ''} />
      <span><strong>NEW</strong> — shows a cyan "NEW" badge on the card</span>
    </label>
    <label class="checkbox-row">
      <input type="checkbox" id="modalItemLimited" ${it.isLimited ? 'checked' : ''} />
      <span><strong>LIMITED</strong> — shows a pink "LIMITED" badge on the card</span>
    </label>
    <label class="checkbox-row">
      <input type="checkbox" id="modalItemSoldOut" ${it.soldOut ? 'checked' : ''} />
      <span><strong>SOLD OUT</strong> — item still shown but greyed out and unclickable</span>
    </label>

    <label>URL slug (optional)</label>
    <input id="modalItemId" value="${escapeAttr(it.id)}" placeholder="auto from name if blank" />
  `, async () => {
    const updated = {
      id: (document.getElementById('modalItemId').value.trim() || slugify(document.getElementById('modalItemName').value)),
      name: document.getElementById('modalItemName').value.trim(),
      priceUSD: parseFloat(document.getElementById('modalItemPrice').value) || 0,
      url: document.getElementById('modalItemUrl').value.trim(),
      isNew: document.getElementById('modalItemNew').checked,
      isLimited: document.getElementById('modalItemLimited').checked,
      soldOut: document.getElementById('modalItemSoldOut').checked,
      image: it.image || '',
    };
    if (!updated.name) { alert('Name required'); return false; }

    const file = document.getElementById('modalItemFile').files[0];
    if (file) {
      try {
        showSpinner('Uploading image...');
        updated.image = await uploadImage(file);
      } catch (e) {
        alert('Image upload failed: ' + e.message); hideSpinner(); return false;
      }
      hideSpinner();
    }

    if (isCreating) BarkEditor.data.store.push(updated);
    else            BarkEditor.data.store[index] = updated;
    BarkEditor.dirty = true;
    rerenderPage();
    return true;
  });
}

function deleteStoreItem(index) {
  const it = BarkEditor.data.store[index];
  if (!confirm(`Delete store item "${it.name}"?`)) return;
  BarkEditor.data.store.splice(index, 1);
  BarkEditor.dirty = true;
  rerenderPage();
}

// ----------------------------------------------------------
//  GENERIC MODAL
// ----------------------------------------------------------
function showModal(title, bodyHtml, onSave, onMount) {
  const existing = document.getElementById('barkModal');
  if (existing) existing.remove();

  const m = document.createElement('div');
  m.id = 'barkModal';
  m.className = 'bark-modal';
  m.innerHTML = `
    <div class="bark-modal-backdrop"></div>
    <div class="bark-modal-card">
      <div class="bark-modal-head">
        <h3>${escapeHtml(title)}</h3>
        <button class="bark-modal-close" type="button">✕</button>
      </div>
      <div class="bark-modal-body">${bodyHtml}</div>
      <div class="bark-modal-foot">
        <button class="btn-ghost" id="modalCancel" type="button">Cancel</button>
        <button class="btn-primary" id="modalSave" type="button">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(m);

  const close = () => m.remove();
  m.querySelector('.bark-modal-close').onclick = close;
  m.querySelector('.bark-modal-backdrop').onclick = close;
  m.querySelector('#modalCancel').onclick = close;
  m.querySelector('#modalSave').onclick = async () => {
    const ok = await onSave();
    if (ok !== false) close();
  };

  // Photo preview
  const photoFile = m.querySelector('#modalPhotoFile');
  if (photoFile) photoFile.addEventListener('change', e => previewInto('modalPhotoPreview', e.target.files[0]));
  const shotFile = m.querySelector('#modalShotFile');
  if (shotFile) shotFile.addEventListener('change', e => previewInto('modalShotPreview', e.target.files[0]));
  const itemFile = m.querySelector('#modalItemFile');
  if (itemFile) itemFile.addEventListener('change', e => previewInto('modalItemPreview', e.target.files[0]));

  if (onMount) onMount();
}

function previewInto(imgId, file) {
  if (!file) return;
  const img = document.getElementById(imgId);
  if (!img) return;
  const r = new FileReader();
  r.onload = () => { img.src = r.result; img.style.visibility = 'visible'; };
  r.readAsDataURL(file);
}

// ----------------------------------------------------------
//  SPINNER
// ----------------------------------------------------------
function showSpinner(text) {
  let s = document.getElementById('barkSpinner');
  if (!s) {
    s = document.createElement('div');
    s.id = 'barkSpinner';
    s.className = 'bark-spinner';
    document.body.appendChild(s);
  }
  s.innerHTML = `<div class="bark-spinner-inner"><div class="bark-spin"></div><div>${escapeHtml(text || 'Working...')}</div></div>`;
  s.style.display = 'flex';
}
function hideSpinner() {
  const s = document.getElementById('barkSpinner');
  if (s) s.style.display = 'none';
}

// ----------------------------------------------------------
//  UTIL
// ----------------------------------------------------------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function slugify(s) { return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function starRow(n) {
  n = Math.max(0, Math.min(5, Number(n) || 0));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

// Expose handlers used by inline onclicks
window.openTeamModal = openTeamModal;
window.openGameModal = openGameModal;
window.openStoreModal = openStoreModal;
window.deleteTeam = deleteTeam;
window.deleteGame = deleteGame;
window.deleteStoreItem = deleteStoreItem;
window.clearPat = clearPat;

// ----------------------------------------------------------
//  BOOT
// ----------------------------------------------------------
async function bootEditor() {
  try {
    await Promise.all([loadData(), loadBackendUrl()]);
  } catch (e) {
    console.error(e);
    return;
  }

  // Restore signed-in user
  const stored = localStorage.getItem('bark.user');
  if (stored) {
    try { BarkEditor.user = JSON.parse(stored); } catch {}
  }

  // Restore edit-mode state across navigation
  if (BarkEditor.user && isAllowed(BarkEditor.user.email)
      && localStorage.getItem('bark.editing') === '1') {
    BarkEditor.editing = true;
    document.body.classList.add('editing');
  }

  buildEditorBar();
  rerenderPage();

  // Warn before leaving with unsaved edits
  window.addEventListener('beforeunload', e => {
    if (BarkEditor.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Hotkey: Ctrl/Cmd + E toggles edit mode (only when allowed)
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
      if (BarkEditor.user && isAllowed(BarkEditor.user.email)) {
        e.preventDefault();
        toggleEdit();
      }
    }
  });

  // Hotkey: Ctrl/Cmd + Shift + L summons the editor bar from anywhere
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      if (!document.getElementById('editorBar')) {
        const params = new URLSearchParams(location.search);
        params.set('edit', '1');
        history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
        buildEditorBar();
        updateEditorBar();
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', bootEditor);
