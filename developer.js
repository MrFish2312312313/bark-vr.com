/* ============================================================================
   BARKVR — developer.js
   Powers the /developer panel. Uses PlayFab REST (no SDK).
   Calls dev-cloudscript.js handlers (see file with the same name in this repo).
   Title ID + DEV_EMAILS are defined in editor.js so they stay in one place.
   ============================================================================ */

// 🍍

(function () {
  if (!document.getElementById('devPanel')) return; // not on the dev page

  // ------------ helpers ------------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function log(msg, kind) {
    const box = $('devLog');
    if (!box) return;
    if (box.dataset.empty !== '0') { box.innerHTML = ''; box.dataset.empty = '0'; }
    const row = document.createElement('div');
    row.className = 'dev-log-row ' + (kind || 'info');
    const t = new Date().toLocaleTimeString();
    row.innerHTML = `<span class="dev-log-time">${esc(t)}</span> ${esc(msg)}`;
    box.prepend(row);
    while (box.children.length > 50) box.removeChild(box.lastChild);
  }

  function setStatus(msg, ok) {
    const s = $('devStatus');
    if (!s) return;
    s.textContent = msg;
    s.dataset.ok = ok ? '1' : '0';
  }

  // ------------ Google ID token (re-validated server-side) ------------
  function getGoogleIdToken() {
    const tok = localStorage.getItem('bark.googleIdToken');
    const exp = parseInt(localStorage.getItem('bark.googleIdTokenExp') || '0', 10);
    if (!tok || !exp || exp < Date.now() + 60_000) return null; // expired or about to
    return tok;
  }

  // ------------ Gate the panel ------------
  function renderGate() {
    const locked = $('devLocked');
    const panel = $('devPanel');
    const msg = $('devLockedMsg');

    const u = (typeof BarkEditor !== 'undefined' && BarkEditor.user) || null;
    if (!u) {
      locked.style.display = 'block'; panel.style.display = 'none';
      msg.textContent = 'Sign in with a developer Google account to continue.';
      return false;
    }
    if (typeof isDev !== 'function' || !isDev(u.email)) {
      locked.style.display = 'block'; panel.style.display = 'none';
      msg.innerHTML = `Signed in as <strong>${esc(u.email)}</strong> — not on the developer allow-list.`;
      return false;
    }
    if (!getGoogleIdToken()) {
      locked.style.display = 'block'; panel.style.display = 'none';
      msg.innerHTML = 'Your Google session expired. Click below to sign in again so CloudScript can re-verify you.';
      return false;
    }

    locked.style.display = 'none';
    panel.style.display = 'block';
    return true;
  }

  $('devSignInBtn').addEventListener('click', () => {
    if (typeof startSignIn === 'function') startSignIn();
    else if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.prompt();
    }
  });

  // ------------ PlayFab REST ------------
  // We log into PlayFab using LoginWithCustomID. The CustomId is per-browser-
  // session; it does NOT establish identity for the dev (CloudScript verifies
  // the Google ID token on every call). It's just a vehicle for ExecuteCloudScript.
  let pfSession = null; // { ticket, playFabId }

  function pfCustomId() {
    let id = localStorage.getItem('bark.pfDevCustomId');
    if (!id) {
      id = 'devsite_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('bark.pfDevCustomId', id);
    }
    return id;
  }

  async function pfLogin() {
    if (pfSession) return pfSession;
    const titleId = (typeof PLAYFAB_TITLE_ID !== 'undefined') ? PLAYFAB_TITLE_ID : null;
    if (!titleId) throw new Error('PLAYFAB_TITLE_ID not configured');
    const res = await fetch(`https://${titleId}.playfabapi.com/Client/LoginWithCustomID`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        TitleId: titleId,
        CustomId: pfCustomId(),
        CreateAccount: true,
      }),
    });
    const j = await res.json();
    if (j.code !== 200 || !j.data || !j.data.SessionTicket) {
      throw new Error('PlayFab login failed: ' + (j.errorMessage || ('HTTP ' + j.code)));
    }
    pfSession = { ticket: j.data.SessionTicket, playFabId: j.data.PlayFabId };
    return pfSession;
  }

  async function callCloudScript(functionName, args) {
    const tok = getGoogleIdToken();
    if (!tok) { renderGate(); throw new Error('Google token expired — please sign in again'); }
    const sess = await pfLogin();
    const titleId = PLAYFAB_TITLE_ID;
    const params = Object.assign({ idToken: tok }, args || {});
    const res = await fetch(`https://${titleId}.playfabapi.com/Client/ExecuteCloudScript`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Authorization': sess.ticket,
      },
      body: JSON.stringify({
        FunctionName: functionName,
        FunctionParameter: params,
        GeneratePlayStreamEvent: false,
      }),
    });
    const j = await res.json();
    if (j.code !== 200) throw new Error('CloudScript HTTP error: ' + (j.errorMessage || j.code));
    const csErr = j.data && j.data.Error;
    if (csErr) throw new Error('CloudScript runtime error: ' + (csErr.Error || JSON.stringify(csErr)));
    const result = (j.data && j.data.FunctionResult) || {};
    if (result && result.success === false) {
      throw new Error(result.error || 'CloudScript returned success=false');
    }
    return result;
  }

  // ------------ State ------------
  const State = {
    players: [],          // from /linked-profiles
    pfIdByName: {},       // displayName -> PlayFabId (via DevResolvePlayers)
    selected: null,       // { discordId, displayName, playFabId }
    catalog: [],          // [{itemId, displayName, itemClass}]
    woods: [],            // [{ woodID, ... }]
    filter: '',
  };

  // ------------ Players ------------
  async function loadPlayers(force) {
    setStatus('Loading players…');
    if (!BARK_BACKEND_URL) {
      try { await loadBackendUrl(); } catch {}
    }
    if (!BARK_BACKEND_URL) {
      setStatus('Backend URL missing (backend-url.json).', false);
      return;
    }
    try {
      const r = await fetch(`${BARK_BACKEND_URL}/linked-profiles${force ? '?fresh=1' : ''}`);
      const j = await r.json();
      State.players = (j.profiles || []).filter(p => !p.hidden);
      renderPlayers();
      await resolvePlayFabIds();
      setStatus(`PlayFab ✓  •  ${State.players.length} players loaded`, true);
    } catch (e) {
      setStatus('Failed to load players: ' + e.message, false);
    }
  }

  async function resolvePlayFabIds() {
    const names = State.players.map(p => p.displayName).filter(Boolean);
    if (!names.length) return;
    try {
      const r = await callCloudScript('DevResolvePlayers', { displayNames: names });
      State.pfIdByName = r.mapping || {};
      renderPlayers(); // re-render with PlayFab IDs available
    } catch (e) {
      log('Could not resolve PlayFab IDs: ' + e.message, 'err');
    }
  }

  function renderPlayers() {
    const list = $('devPlayerList');
    const f = (State.filter || '').toLowerCase().trim();
    const matches = !f ? State.players : State.players.filter(p =>
      (p.displayName || '').toLowerCase().includes(f) ||
      (p.trelativeName || '').toLowerCase().includes(f) ||
      (p.discordId || '').includes(f)
    );
    if (!matches.length) { list.innerHTML = '<p class="players-empty">No matches.</p>'; return; }
    list.innerHTML = matches.slice(0, 60).map(p => {
      const pf = State.pfIdByName[p.displayName] || '';
      const ready = pf ? '' : ' dev-player-pending';
      return `
        <button type="button" class="dev-player-row${ready}" data-name="${esc(p.displayName)}" data-discord="${esc(p.discordId)}">
          <span class="dev-player-name">${esc(p.displayName)}</span>
          <span class="dev-player-sub">${esc(p.trelativeName || '')}</span>
          <span class="dev-player-pfid">${esc(pf || 'looking up…')}</span>
        </button>
      `;
    }).join('');
    list.querySelectorAll('.dev-player-row').forEach(btn => {
      btn.addEventListener('click', () => selectPlayer(btn.dataset.name, btn.dataset.discord));
    });
  }

  function selectPlayer(displayName, discordId) {
    const pf = State.pfIdByName[displayName];
    if (!pf) { log('PlayFab ID not yet resolved for ' + displayName + ' — try again in a sec', 'err'); return; }
    State.selected = { displayName, discordId, playFabId: pf };
    $('devSelectedBar').style.display = 'flex';
    $('devSelectedName').textContent = displayName;
    $('devSelectedPfId').textContent = pf;
    loadInventory();
  }

  $('devDeselectBtn').addEventListener('click', () => {
    State.selected = null;
    $('devSelectedBar').style.display = 'none';
    $('devInventory').innerHTML = 'Pick a player above.';
  });

  $('devPlayerSearch').addEventListener('input', (e) => {
    State.filter = e.target.value;
    renderPlayers();
  });

  $('devRefreshBtn').addEventListener('click', () => loadPlayers(true));

  // ------------ Inventory ------------
  async function loadInventory() {
    const sel = State.selected;
    if (!sel) return;
    const inv = $('devInventory');
    inv.innerHTML = 'Loading inventory…';
    try {
      const r = await callCloudScript('DevGetInventory', { playfabId: sel.playFabId });
      const items = r.items || [];
      const vc = r.virtualCurrency || {};
      const pc = vc.PC || 0, at = vc.AT || 0;

      const itemsHtml = items.length
        ? items.map(it => `
            <button type="button" class="dev-inv-item" data-instance="${esc(it.itemInstanceId)}" data-item="${esc(it.itemId)}" title="Click to revoke this instance">
              <span class="dev-inv-name">${esc(it.displayName)}</span>
              <span class="dev-inv-id">${esc(it.itemId)}</span>
              <span class="dev-inv-x">✕</span>
            </button>
          `).join('')
        : '<p class="players-empty" style="margin:6px 0;">No items.</p>';

      inv.innerHTML = `
        <div class="dev-vc-row">
          <div class="dev-vc"><span class="dev-vc-label">Paper Coins (PC)</span><span class="dev-vc-val">${pc}</span></div>
          <div class="dev-vc"><span class="dev-vc-label">Arcade Tokens (AT)</span><span class="dev-vc-val">${at}</span></div>
        </div>
        <div class="dev-inv-grid">${itemsHtml}</div>
      `;
      inv.querySelectorAll('.dev-inv-item').forEach(btn => {
        btn.addEventListener('click', () => revokeItem(btn.dataset.instance, btn.dataset.item));
      });
    } catch (e) {
      inv.innerHTML = `<p class="players-empty">Inventory load failed: ${esc(e.message)}</p>`;
    }
  }

  async function revokeItem(itemInstanceId, itemId) {
    const sel = State.selected; if (!sel) return;
    if (!confirm(`Revoke "${itemId}" from ${sel.displayName}?`)) return;
    try {
      await callCloudScript('DevRevokeItem', {
        playfabId: sel.playFabId,
        itemInstanceId: itemInstanceId,
      });
      log(`Revoked ${itemId} from ${sel.displayName}`, 'ok');
      loadInventory();
    } catch (e) {
      log('Revoke failed: ' + e.message, 'err');
      alert('Revoke failed: ' + e.message);
    }
  }

  // ------------ Catalog ------------
  async function loadCatalog() {
    const sel = $('devItemSelect');
    sel.innerHTML = '<option value="">(loading…)</option>';
    try {
      const r = await callCloudScript('DevGetCatalog', {});
      State.catalog = (r.items || []).sort((a, b) =>
        (a.displayName || a.itemId).localeCompare(b.displayName || b.itemId)
      );
      if (!State.catalog.length) {
        sel.innerHTML = '<option value="">(empty catalog)</option>';
        return;
      }
      sel.innerHTML = '<option value="">— pick an item —</option>' +
        State.catalog.map(c =>
          `<option value="${esc(c.itemId)}">${esc(c.displayName)} — ${esc(c.itemId)}${c.itemClass ? ' [' + esc(c.itemClass) + ']' : ''}</option>`
        ).join('');
    } catch (e) {
      sel.innerHTML = '<option value="">(catalog load failed)</option>';
      log('Catalog load failed: ' + e.message, 'err');
    }
  }

  $('devReloadCatalogBtn').addEventListener('click', loadCatalog);

  $('devGiveItemBtn').addEventListener('click', async () => {
    const sel = State.selected;
    if (!sel) { alert('Pick a player first.'); return; }
    const itemId = ($('devItemIdManual').value || $('devItemSelect').value || '').trim();
    if (!itemId) { alert('Pick an item or enter an item ID.'); return; }
    const qty = Math.max(1, parseInt($('devItemQty').value, 10) || 1);
    try {
      await callCloudScript('DevGiveItem', {
        playfabId: sel.playFabId, itemId, quantity: qty,
      });
      log(`Gave ${qty}× ${itemId} to ${sel.displayName}`, 'ok');
      loadInventory();
    } catch (e) {
      log('Give failed: ' + e.message, 'err');
      alert('Give failed: ' + e.message);
    }
  });

  // ------------ Currency ------------
  $('devCurrencyAddBtn').addEventListener('click', async () => {
    const sel = State.selected; if (!sel) { alert('Pick a player first.'); return; }
    const code = $('devCurrencySelect').value;
    const amount = parseInt($('devCurrencyAmount').value, 10) || 0;
    if (!amount) { alert('Amount must be non-zero.'); return; }
    try {
      const r = await callCloudScript('DevAddCurrency', {
        playfabId: sel.playFabId, currencyCode: code, amount,
      });
      log(`${amount > 0 ? '+' : ''}${amount} ${code} → ${sel.displayName} (balance now ${r.balance})`, 'ok');
      loadInventory();
    } catch (e) {
      log('Currency change failed: ' + e.message, 'err');
      alert('Currency change failed: ' + e.message);
    }
  });

  $('devCurrencySetBtn').addEventListener('click', async () => {
    const sel = State.selected; if (!sel) { alert('Pick a player first.'); return; }
    const code = $('devCurrencySelect').value;
    const target = parseInt($('devCurrencyAmount').value, 10);
    if (isNaN(target) || target < 0) { alert('Target must be a non-negative integer.'); return; }
    if (!confirm(`Set ${sel.displayName}'s ${code} to exactly ${target}?`)) return;
    try {
      const r = await callCloudScript('DevSetCurrencyTo', {
        playfabId: sel.playFabId, currencyCode: code, target,
      });
      log(`Set ${code} = ${r.balance} for ${sel.displayName}`, 'ok');
      loadInventory();
    } catch (e) {
      log('Currency set failed: ' + e.message, 'err');
      alert('Currency set failed: ' + e.message);
    }
  });

  // ------------ Wood ------------
  async function loadWoods() {
    const sel = $('devWoodSelect');
    try {
      let woods = [];
      if (typeof loadWoodTypes === 'function') {
        woods = await loadWoodTypes();
      } else {
        const r = await fetch('wood-types.json?t=' + Date.now());
        const j = await r.json();
        woods = j.woodTypes || [];
      }
      State.woods = woods;
      if (!woods.length) { sel.innerHTML = '<option value="">(no wood types)</option>'; return; }
      sel.innerHTML = '<option value="">— pick a wood —</option>' +
        woods.map(w => `<option value="${esc(w.woodID)}">${esc(w.woodID)}</option>`).join('');
    } catch (e) {
      sel.innerHTML = '<option value="">(wood load failed)</option>';
    }
  }

  $('devSetWoodBtn').addEventListener('click', async () => {
    const sel = State.selected; if (!sel) { alert('Pick a player first.'); return; }
    const woodId = ($('devWoodManual').value || $('devWoodSelect').value || '').trim();
    if (!woodId) { alert('Pick a wood or enter a woodID.'); return; }
    try {
      await callCloudScript('DevSetWood', { playfabId: sel.playFabId, woodId });
      log(`Set wood to ${woodId} for ${sel.displayName}`, 'ok');
    } catch (e) {
      log('Set wood failed: ' + e.message, 'err');
      alert('Set wood failed: ' + e.message);
    }
  });

  // ------------ Boot ------------
  async function boot() {
    if (!renderGate()) return;
    try {
      await pfLogin();
      const ping = await callCloudScript('DevPing', {});
      setStatus(`PlayFab ✓  •  authorized as ${ping.email}`, true);
      log('Authorized as ' + ping.email, 'ok');
      loadPlayers(false);
      loadCatalog();
      loadWoods();
    } catch (e) {
      setStatus('Auth failed: ' + e.message, false);
      log('Boot failed: ' + e.message, 'err');
    }
  }

  // Expose for editor.js to expose BARK_BACKEND_URL globally
  window.devPanelBoot = boot;

  // Wait for editor.js to finish booting (it owns BarkEditor + BARK_BACKEND_URL).
  // bootEditor() is called on DOMContentLoaded inside editor.js. We poll briefly.
  function waitForEditor(retries) {
    const editorReady = typeof BarkEditor !== 'undefined';
    const backendReady = typeof BARK_BACKEND_URL !== 'undefined' && BARK_BACKEND_URL;
    if (editorReady && (backendReady || retries <= 0)) {
      boot();
    } else {
      setTimeout(() => waitForEditor((retries || 30) - 1), 200);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waitForEditor(30));
  } else {
    waitForEditor(30);
  }
})();
