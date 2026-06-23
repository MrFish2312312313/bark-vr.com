// community.js — BARK Community (posts & discussions).
// ---------------------------------------------------------------------------
// ANY Google user can sign in and post text + an image — no editor key, no
// saving key. Posts live on the Bark backend (BARK_BACKEND_URL). Editors
// (DEV_EMAILS) get a delete button on every post for moderation.
//
// Reuses globals from editor.js (loaded first on this page): GOOGLE_CLIENT_ID,
// isDev, escapeHtml, escapeAttr, loadBackendUrl, BARK_BACKEND_URL.
//
// Backend endpoints expected (add these to bark-link-backend):
//   GET    /community/posts?limit=50
//            → [{ id, authorName, authorPicture, authorSub, text, imageUrl, createdAt }]
//   POST   /community/posts            Authorization: Bearer <googleIdToken>
//            body { text, image }  (image = data-URL or null)
//            → server verifies the token (aud = GOOGLE_CLIENT_ID), stores the
//              image, creates the post, returns it.
//   DELETE /community/posts/:id        Authorization: Bearer <googleIdToken>
//            → allow if token email ∈ DEV_EMAILS (or the post's author).
//
// A pineapple lurks in the feed. 🍍
// ---------------------------------------------------------------------------
(function () {
  'use strict';

  const LS_TOKEN = 'bark.communityToken';
  const LS_EXP   = 'bark.communityTokenExp';
  const Community = { user: null, token: null, posts: [] };

  // Local JWT payload decode (don't depend on an editor.js internal).
  function jwtPayload(t) {
    try {
      const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(b))));
    } catch (e) { return null; }
  }

  function init() {
    const root = document.getElementById('communityRoot');
    if (!root) return;
    const tok = localStorage.getItem(LS_TOKEN);
    const exp = +(localStorage.getItem(LS_EXP) || 0);
    if (tok && exp > Date.now()) {
      const p = jwtPayload(tok);
      if (p) { Community.token = tok; Community.user = { name: p.name, email: p.email, picture: p.picture, sub: p.sub }; }
    }
    render();
    loadPosts();
  }

  function render() {
    const root = document.getElementById('communityRoot');
    if (!root) return;
    const u = Community.user;
    root.innerHTML = `
      <div class="cm-bar">
        ${u ? `
          <div class="cm-me">
            ${u.picture ? `<img src="${escapeAttr(u.picture)}" class="cm-avatar" referrerpolicy="no-referrer"/>` : '<div class="cm-avatar cm-avatar-ph"></div>'}
            <span>${escapeHtml(u.name || u.email || 'You')}</span>
            ${isDev(u.email) ? '<span class="cm-mod-badge">mod</span>' : ''}
          </div>
          <button class="btn-ghost" id="cmSignOut">Sign out</button>
        ` : `
          <button class="btn-primary" id="cmSignIn">Sign in with Google to post</button>
        `}
      </div>
      ${u ? `
        <div class="cm-composer">
          <textarea id="cmText" rows="3" maxlength="2000" placeholder="Share something with the Bark community…"></textarea>
          <div class="cm-composer-row">
            <label class="cm-imgbtn">📷 Image<input type="file" id="cmImage" accept="image/*" hidden /></label>
            <span class="cm-imgname" id="cmImgName"></span>
            <button class="btn-primary" id="cmPost">Post</button>
          </div>
        </div>
      ` : '<p class="cm-signedout-note">Sign in with Google to join the discussion. Anyone can post — be kind. 🌳</p>'}
      <div class="cm-feed" id="cmFeed"><p class="players-empty">Loading…</p></div>
    `;
    wire();
    renderFeed();
  }

  function wire() {
    const byId = id => document.getElementById(id);
    if (byId('cmSignIn'))  byId('cmSignIn').onclick  = signIn;
    if (byId('cmSignOut')) byId('cmSignOut').onclick = signOut;
    if (byId('cmPost'))    byId('cmPost').onclick     = submitPost;
    const img = byId('cmImage');
    if (img) img.onchange = () => { const f = img.files[0]; byId('cmImgName').textContent = f ? f.name : ''; };
  }

  // ── Auth (any Google user) ────────────────────────────────────────────────
  function signIn() {
    if (!window.google || !google.accounts || !google.accounts.id) {
      alert('Google Sign-In didn’t load. Check your connection and refresh.'); return;
    }
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onCred, auto_select: false, cancel_on_tap_outside: true });
    google.accounts.id.prompt(n => { if (n.isNotDisplayed() || n.isSkippedMoment()) buttonFallback(); });
  }

  function buttonFallback() {
    document.getElementById('cmGsiFallback')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'cmGsiFallback';
    wrap.className = 'bark-modal';
    wrap.innerHTML = `
      <div class="bark-modal-backdrop"></div>
      <div class="bark-modal-card" style="max-width:360px;">
        <div class="bark-modal-head"><h3>Sign in with Google</h3><button class="bark-modal-close" type="button">✕</button></div>
        <div class="bark-modal-body" style="display:flex;justify-content:center;padding:24px;"><div id="cmGsiHost"></div></div>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelector('.bark-modal-close').onclick = close;
    wrap.querySelector('.bark-modal-backdrop').onclick = close;
    google.accounts.id.renderButton(document.getElementById('cmGsiHost'), { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill' });
  }

  function onCred(resp) {
    document.getElementById('cmGsiFallback')?.remove();
    const p = jwtPayload(resp.credential);
    if (!p) { alert('Sign-in failed.'); return; }
    Community.token = resp.credential;
    Community.user = { name: p.name, email: p.email, picture: p.picture, sub: p.sub };
    localStorage.setItem(LS_TOKEN, resp.credential);
    localStorage.setItem(LS_EXP, String((p.exp || 0) * 1000));
    render();
  }

  function signOut() {
    Community.token = null; Community.user = null;
    localStorage.removeItem(LS_TOKEN); localStorage.removeItem(LS_EXP);
    render();
  }

  // ── Backend ───────────────────────────────────────────────────────────────
  async function api(path, opts) {
    if (typeof BARK_BACKEND_URL === 'undefined' || !BARK_BACKEND_URL) {
      if (typeof loadBackendUrl === 'function') await loadBackendUrl();
    }
    if (!BARK_BACKEND_URL) throw new Error('Backend not configured.');
    return fetch(BARK_BACKEND_URL.replace(/\/$/, '') + path, opts);
  }

  async function loadPosts() {
    try {
      const r = await api('/community/posts?limit=50');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      Community.posts = Array.isArray(j) ? j : (j.posts || []);
    } catch (e) {
      Community.posts = null; // error sentinel
      console.warn('[community] load failed:', e.message);
    }
    renderFeed();
  }

  async function submitPost() {
    const text = (document.getElementById('cmText').value || '').trim();
    const file = document.getElementById('cmImage').files[0];
    if (!text && !file) { alert('Write something or add an image.'); return; }
    const btn = document.getElementById('cmPost');
    if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }
    try {
      let image = null;
      if (file) {
        if (file.size > 5 * 1024 * 1024) throw new Error('Image too large (max 5 MB).');
        image = await fileToDataUrl(file);
      }
      const r = await api('/community/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + Community.token },
        body: JSON.stringify({ text, image }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text().catch(() => '')));
      document.getElementById('cmText').value = '';
      document.getElementById('cmImage').value = '';
      document.getElementById('cmImgName').textContent = '';
      await loadPosts();
    } catch (e) {
      alert('Post failed: ' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Post'; }
    }
  }

  async function deletePost(id) {
    if (!confirm('Delete this post?')) return;
    try {
      const r = await api('/community/posts/' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + Community.token },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await loadPosts();
    } catch (e) { alert('Delete failed: ' + e.message); }
  }

  function renderFeed() {
    const feed = document.getElementById('cmFeed');
    if (!feed) return;
    if (Community.posts === null) {
      feed.innerHTML = `<p class="players-empty">Couldn’t load the community feed — the backend may be offline.</p>`;
      return;
    }
    if (!Community.posts.length) {
      feed.innerHTML = `<p class="players-empty">No posts yet. Be the first!</p>`;
      return;
    }
    const canMod = Community.user && isDev(Community.user.email);
    feed.innerHTML = Community.posts.map(p => {
      const when = p.createdAt ? new Date(p.createdAt).toLocaleString() : '';
      return `
        <div class="cm-post">
          <div class="cm-post-head">
            ${p.authorPicture ? `<img src="${escapeAttr(p.authorPicture)}" class="cm-avatar" referrerpolicy="no-referrer"/>` : '<div class="cm-avatar cm-avatar-ph"></div>'}
            <div class="cm-post-meta">
              <span class="cm-post-author">${escapeHtml(p.authorName || 'Someone')}</span>
              <span class="cm-post-time">${escapeHtml(when)}</span>
            </div>
            ${canMod ? `<button class="cm-del" data-del="${escapeAttr(String(p.id))}" title="Delete (mod)">✕</button>` : ''}
          </div>
          ${p.text ? `<p class="cm-post-text">${linkify(escapeHtml(p.text))}</p>` : ''}
          ${p.imageUrl ? `<img src="${escapeAttr(mediaUrl(p.imageUrl))}" class="cm-post-img" loading="lazy" />` : ''}
        </div>`;
    }).join('');
    feed.querySelectorAll('[data-del]').forEach(b => b.onclick = () => deletePost(b.dataset.del));
  }

  // Backend returns relative "/media/…" image paths — resolve against the
  // backend URL (Google avatar URLs are already absolute).
  function mediaUrl(u) {
    if (!u) return '';
    if (/^https?:\/\//.test(u)) return u;
    const base = (typeof BARK_BACKEND_URL !== 'undefined' && BARK_BACKEND_URL) ? BARK_BACKEND_URL.replace(/\/$/, '') : '';
    return base + u;
  }

  function fileToDataUrl(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  }
  function linkify(s) {
    return s.replace(/(https?:\/\/[^\s]+)/g, m => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
