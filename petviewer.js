// petviewer.js — BARK "Extra Info → Pet Viewer"
// ---------------------------------------------------------------------------
// Renders the pet roster with a live Three.js 3D model you can drag-rotate,
// RECOLOR via "Simulate spawn", and audition sounds. Editors can add/hide pets
// and define breeding mutations (drawn as a 2-parents → 1-result brace graph).
//
// Reuses the editor framework declared in editor.js (loaded first): BarkEditor,
// showModal, uploadImage, escapeHtml/escapeAttr, slugify, updateEditorBar,
// showSpinner/hideSpinner. Three.js (r128 UMD) + GLTFLoader + OrbitControls are
// loaded from CDN in database.html; everything degrades gracefully if absent.
//
// Data shape (data.json):
//   pets:        [{ id,name,description,hidden,image,model,modelScale,sounds[],
//                   normalColors[],naturalColors:('random'|[hex]) }]
//   mutations:   [{ id,parentA,parentB,result,note }]   // ids reference pets
//   petsConfig:  { mutationsPublic: bool }
//
// A pineapple suns itself just out of frame. 🍍
// ---------------------------------------------------------------------------
(function () {
  'use strict';

  const PETS = () => (BarkEditor.data.pets = BarkEditor.data.pets || []);
  const MUTS = () => (BarkEditor.data.mutations = BarkEditor.data.mutations || []);
  const CFG  = () => (BarkEditor.data.petsConfig = BarkEditor.data.petsConfig || { mutationsPublic: false });
  // Cache-buster for the network fetch: re-exported .glb models keep the SAME url,
  // so without this the browser serves a stale model forever. modelsVersion is
  // stamped into data.json by the Unity exporter on every export.
  const modelUrl = (m) => m + (m.indexOf('?') < 0 ? '?' : '&') + 'v=' + (BarkEditor.data.modelsVersion || '0');

  const State = {
    activeId: null, three: null, audio: null, loadToken: 0, resizeHooked: false,
    skinByPet: {}, texCache: {},
    modelCache: new Map(),   // url -> parsed gltf scene (reused, not re-parsed)
    modelOrder: [],          // LRU order of cached urls
    shownKey: null,          // key of the model currently in the scene
  };
  const MODEL_CACHE_MAX = 8;

  const petById = (id) => PETS().find(p => p.id === id) || null;
  const visiblePets = () => PETS().filter(p => BarkEditor.editing || !p.hidden);

  // ── Main render ──────────────────────────────────────────────────────────
  function render() {
    const root = document.getElementById('petViewer');
    if (!root) return;
    const editing = !!BarkEditor.editing;
    const pets = visiblePets();

    if (!State.activeId || !petById(State.activeId) ||
        (!editing && petById(State.activeId).hidden)) {
      State.activeId = pets.length ? pets[0].id : null;
    }

    // Preserve the pet list's scroll position across a full re-render.
    const prevList = root.querySelector('#pvList');
    const prevScroll = prevList ? prevList.scrollLeft : 0;

    root.innerHTML = `
      <div class="pv-toolbar">
        <div class="section-label">// PET VIEWER</div>
        <div class="pv-toolbar-actions">
          ${editing ? `
            <button class="btn-secondary" id="pvAddPet">+ Add pet</button>
            <button class="btn-secondary" id="pvMuts">Mutations…</button>
            <label class="pv-toggle"><input type="checkbox" id="pvMutPublic" ${CFG().mutationsPublic ? 'checked' : ''}/> Mutations public</label>
          ` : ''}
        </div>
      </div>
      <div class="pv-main">
        <div class="pv-list" id="pvList"></div>
        <div class="pv-stage" id="pvStage"></div>
      </div>
    `;

    const list = root.querySelector('#pvList');
    if (!pets.length) {
      list.innerHTML = `<p class="players-empty">No pets yet.${editing ? ' Click "+ Add pet".' : ''}</p>`;
    } else {
      pets.forEach(p => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'pv-list-item' + (p.id === State.activeId ? ' active' : '') + (p.hidden ? ' is-hidden' : '');
        el.innerHTML = `
          <span class="pv-list-dot" style="background:${escapeAttr((p.normalColors && p.normalColors[0]) || '#888')}"></span>
          <span class="pv-list-name">${escapeHtml(p.name || 'Unnamed')}</span>
          ${p.hidden ? '<span class="pv-hidden-badge">hidden</span>' : ''}
        `;
        el.dataset.petId = p.id;
        // Selecting a pet must NOT rebuild the list (that reset the horizontal
        // scroll to the start on mobile every click). Just restyle + re-stage.
        el.onclick = () => selectPet(p.id);
        list.appendChild(el);
      });
    }
    if (list) list.scrollLeft = prevScroll;   // keep mobile scroll position across re-renders

    if (editing) {
      root.querySelector('#pvAddPet').onclick = () => openPetModal(null);
      root.querySelector('#pvMuts').onclick = () => openMutationsModal();
      root.querySelector('#pvMutPublic').onchange = (e) => {
        CFG().mutationsPublic = e.target.checked;
        BarkEditor.dirty = true; updateEditorBar(); render();
      };
    }

    renderStage(root.querySelector('#pvStage'));
  }

  // Lightweight selection: restyle the list in place (no rebuild → no scroll
  // jump) and re-render only the stage.
  function selectPet(id) {
    State.activeId = id;
    const root = document.getElementById('petViewer');
    if (!root) return;
    root.querySelectorAll('.pv-list-item').forEach(el =>
      el.classList.toggle('active', el.dataset.petId === id));
    const stage = root.querySelector('#pvStage');
    if (stage) renderStage(stage);
  }

  // ── Selected-pet stage ───────────────────────────────────────────────────
  function renderStage(stage) {
    const pet = petById(State.activeId);
    if (!pet) { stage.innerHTML = `<p class="players-empty">Select a pet.</p>`; return; }
    const editing = !!BarkEditor.editing;
    const showMuts = CFG().mutationsPublic || editing;

    const naturalHtml = pet.naturalColors === 'random'
      ? '<span class="pv-random">Random</span>'
      : (swatches(pet.naturalColors || []) || '<span class="pv-random">—</span>');
    const normalHtml = swatches(pet.normalColors || []) || '<span class="pv-random">—</span>';
    const hasSound = pet.sounds && pet.sounds.length;

    stage.innerHTML = `
      <div class="pv-viewer">
        <div class="pv-canvas-wrap" id="pvCanvasWrap">
          ${typeof THREE === 'undefined'
            ? `<div class="pv-no3d">3D viewer unavailable (couldn't load Three.js).</div>`
            : ''}
        </div>
        ${(pet.skins && pet.skins.length)
          ? `<div class="pv-skinrow"><label class="pv-color-label" style="margin:0;">Skin</label><select id="pvSkin">${skinOptions(pet)}</select></div>`
          : ''}
        <div class="pv-controls">
          <button class="btn-secondary" id="pvSpawn">🎲 Simulate spawn</button>
          <button class="btn-secondary" id="pvSound" ${hasSound ? '' : 'disabled'}>🔊 Test sound</button>
          ${editing ? `
            <button class="btn-secondary" id="pvEdit">✎ Edit</button>
            <button class="btn-secondary" id="pvTex">🎨 Textures…</button>
            <button class="btn-secondary" id="pvHide">${pet.hidden ? 'Show' : 'Hide'}</button>
            <button class="btn-secondary pv-danger" id="pvDel">Delete</button>` : ''}
        </div>
        <div class="pv-rolled" id="pvRolled"></div>
        <p class="pv-hint">Drag to rotate · scroll to zoom</p>
      </div>
      <div class="pv-info">
        <h2 class="pv-name">${escapeHtml(pet.name || 'Unnamed')}${pet.hidden ? ' <span class="pv-hidden-badge">hidden</span>' : ''}</h2>
        ${pet.description ? `<p class="pv-desc">${escapeHtml(pet.description)}</p>` : ''}
        <div class="pv-colorblock"><div class="pv-color-label">Normal colors</div>${normalHtml}</div>
        <div class="pv-colorblock"><div class="pv-color-label">Natural colors</div>${naturalHtml}</div>
        ${showMuts ? renderMutationsFor(pet) : ''}
      </div>
    `;

    stage.querySelector('#pvSpawn').onclick = () => simulateSpawn(pet);
    const sb = stage.querySelector('#pvSound');
    if (sb && hasSound) sb.onclick = () => testSound(pet);
    const skinSel = stage.querySelector('#pvSkin');
    if (skinSel) skinSel.onchange = () => {
      State.skinByPet[pet.id] = skinSel.value;
      applyTextureState(pet, skinSel.value);
    };
    if (editing) {
      stage.querySelector('#pvEdit').onclick = () => openPetModal(pet.id);
      stage.querySelector('#pvTex').onclick = () => openTexturesModal(pet.id);
      stage.querySelector('#pvHide').onclick = () => { pet.hidden = !pet.hidden; BarkEditor.dirty = true; updateEditorBar(); render(); };
      stage.querySelector('#pvDel').onclick = () => deletePet(pet.id);
    }

    if (typeof THREE !== 'undefined') {
      ensureThree(stage.querySelector('#pvCanvasWrap'));
      loadModel(pet);
    }
  }

  // ── Colors / swatches ────────────────────────────────────────────────────
  function swatches(arr) {
    if (!Array.isArray(arr) || !arr.length) return '';
    return `<div class="pv-swatches">` +
      arr.map(c => `<span class="pv-swatch" style="background:${escapeAttr(c)}" title="${escapeAttr(c)}"></span>`).join('') +
      `</div>`;
  }

  function parseHexList(s) {
    return (s || '').split(',').map(x => x.trim()).filter(Boolean)
      .map(x => (x[0] === '#' ? x : '#' + x));
  }

  function randHex() {
    return hslToHex(Math.floor(Math.random() * 360), 55 + Math.random() * 35, 45 + Math.random() * 20);
  }

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
  }

  // ── Simulate spawn + sounds ──────────────────────────────────────────────
  function rollColors(pet) {
    const count = Math.max(1, (pet.normalColors && pet.normalColors.length) || 2);
    const pool = pet.naturalColors;
    const out = [];
    if (pool === 'random' || !Array.isArray(pool) || !pool.length) {
      for (let i = 0; i < count; i++) out.push(randHex());
    } else {
      for (let i = 0; i < count; i++) out.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    return out;
  }

  // Roll one color for a single exported color slot, mirroring the in-game
  // PetColorRandomizer modes.
  function rollSlotColor(slot) {
    const mode = slot.mode || 'Palette';
    if (mode === 'Normal') return slot.normal || '#cccccc';
    if (mode === 'Random') return randHex();
    const pal = (Array.isArray(slot.palette) && slot.palette.length)
      ? slot.palette
      : (slot.normal ? [slot.normal] : null);
    return pal ? pal[Math.floor(Math.random() * pal.length)] : randHex();
  }

  // Tint each slot's rolled color onto the GLB material whose name matches the
  // slot's exported `material`. Returns true if anything matched (false → no
  // model / name mismatch, caller should fall back to cycling).
  function applyByMaterial(rolled) {
    const t = State.three;
    if (!t || !t.materialsByName) return false;
    let any = false;
    rolled.forEach(r => {
      const mats = r.material && t.materialsByName[r.material];
      if (mats && mats.length) {
        mats.forEach(m => { try { m.color.set(r.color); } catch (e) {} });
        any = true;
      }
    });
    return any;
  }

  function simulateSpawn(pet) {
    const el = document.getElementById('pvRolled');

    // Preferred path: per-slot roll → recolor the exact submesh by material name.
    // Supports any number of slots/colors.
    if (Array.isArray(pet.colorSlots) && pet.colorSlots.length) {
      const rolled = pet.colorSlots.map(s => ({
        material: s.material || '',
        name: s.name || '',
        color: rollSlotColor(s),
      }));
      applyByMaterial(rolled);
      // NOTE: no cycle-fallback here. On a real model, a name mismatch must NOT
      // repaint every submesh (that was painting non-slot parts like the duck's
      // beak). Only the placeholder blob (handled below) ever cycles.
      const t = State.three;
      const isPlaceholder = !t || !t.materialsByName || Object.keys(t.materialsByName).length === 0;
      if (isPlaceholder) applyColors(rolled.map(r => r.color));
      if (el) el.innerHTML = `<span class="pv-color-label">Rolled spawn</span>${swatches(rolled.map(r => r.color))}`;
      return;
    }

    // Legacy pets (no colorSlots exported): cycle the natural/normal colors.
    const rolled = rollColors(pet);
    applyColors(rolled);
    if (el) el.innerHTML = `<span class="pv-color-label">Rolled spawn</span>${swatches(rolled)}`;
  }

  function testSound(pet) {
    if (!pet.sounds || !pet.sounds.length) return;
    if (State.audio) { try { State.audio.pause(); } catch (e) {} }
    const src = pet.sounds[Math.floor(Math.random() * pet.sounds.length)];
    State.audio = new Audio(src);
    State.audio.play().catch(err => console.warn('[petviewer] sound failed:', src, err));
  }

  // ── Three.js ─────────────────────────────────────────────────────────────
  function ensureThree(wrap) {
    if (typeof THREE === 'undefined' || !wrap) return;

    if (State.three) {
      // Reuse the single renderer/context — just move its canvas into the new
      // wrap (the stage HTML is rebuilt on every render). Creating a fresh
      // WebGL context per render would exhaust the browser's context limit.
      if (State.three.renderer.domElement.parentNode !== wrap) wrap.appendChild(State.three.renderer.domElement);
      State.three.wrap = wrap;
      onResize();
      return;
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    camera.position.set(0, 0.6, 3);

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.85); dir.position.set(3, 5, 2); scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0x88ccff, 0.3); dir2.position.set(-3, 2, -2); scene.add(dir2);

    const group = new THREE.Group(); scene.add(group);

    let controls = null;
    if (THREE.OrbitControls) {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enablePan = false;
      controls.minDistance = 0.4;
      controls.maxDistance = 30;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 1.1;
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
    }

    State.three = { wrap, renderer, scene, camera, controls, group, recolorables: [], materialsByName: {}, raf: 0 };
    onResize();

    const loop = () => {
      const t = State.three; if (!t) return;
      t.raf = requestAnimationFrame(loop);
      // Skip GPU work while the Extra Info tab is hidden (offsetParent null).
      if (!t.wrap || t.wrap.offsetParent === null) return;
      if (t.controls) t.controls.update();
      t.renderer.render(t.scene, t.camera);
    };
    loop();

    if (!State.resizeHooked) {
      State.resizeHooked = true;
      window.addEventListener('resize', onResize);
    }
  }

  function onResize() {
    const t = State.three; if (!t) return;
    const w = Math.max(1, t.wrap.clientWidth || 420);
    const h = Math.max(1, t.wrap.clientHeight || 360);
    t.renderer.setSize(w, h, false);
    t.camera.aspect = w / h;
    t.camera.updateProjectionMatrix();
  }

  // Remove whatever's currently shown. GLB scenes are CACHED (kept in memory,
  // not disposed) so re-selecting a pet doesn't re-parse it — that re-parse,
  // with textures + GPU uploads every click, was the freeze. Primitive blobs
  // aren't cached, so they get disposed.
  function detachCurrent() {
    const t = State.three; if (!t) return;
    while (t.group.children.length) {
      const c = t.group.children[0];
      t.group.remove(c);
      if (c.userData && c.userData._isPrimitive) disposeObject(c);
    }
    t.recolorables = [];
    t.materialsByName = {};
  }

  function loadModel(pet) {
    const t = State.three; if (!t) return;
    try {
      const key = pet.model || ('__prim_' + pet.id);
      // Already showing this exact model → just re-apply colors, don't rebuild.
      if (State.shownKey === key && t.group.children.length) {
        applyNormalColors(pet);
        applyTextureState(pet, State.skinByPet[pet.id] || '__default');
        return;
      }
      detachCurrent();
      const token = ++State.loadToken;

      if (pet.model && THREE.GLTFLoader) {
        const cached = State.modelCache.get(pet.model);
        if (cached) { showScene(pet, cached, key); return; }
        new THREE.GLTFLoader().load(
          modelUrl(pet.model),
          (gltf) => {
            if (!State.three || token !== State.loadToken) return; // superseded
            const obj = gltf.scene || (gltf.scenes && gltf.scenes[0]);
            if (!obj) { showPrimitive(pet, key); return; }
            cacheScene(pet.model, obj);
            showScene(pet, obj, key);
          },
          undefined,
          (err) => {
            if (token !== State.loadToken) return;
            console.warn('[petviewer] model load failed:', pet.model, err);
            showPrimitive(pet, key);
          }
        );
      } else {
        showPrimitive(pet, key);
      }
    } catch (e) {
      console.warn('[petviewer] loadModel error:', e);
    }
  }

  function showScene(pet, obj, key) {
    const t = State.three; if (!t) return;
    try {
      t.group.add(obj);
      State.shownKey = key;
      collectRecolorables(obj);
      frameGroup(pet);
      applyNormalColors(pet);
      applyTextureState(pet, State.skinByPet[pet.id] || '__default');
    } catch (e) { console.warn('[petviewer] showScene error:', e); }
  }

  function showPrimitive(pet, key) {
    const t = State.three; if (!t) return;
    addPrimitive(pet);
    State.shownKey = key;
    frameGroup(pet);
  }

  function cacheScene(url, obj) {
    State.modelCache.set(url, obj);
    State.modelOrder = State.modelOrder.filter(u => u !== url);
    State.modelOrder.push(url);
    // Evict least-recently-used (but never the one on screen).
    while (State.modelOrder.length > MODEL_CACHE_MAX) {
      const old = State.modelOrder[0];
      if (old === State.shownKey) break;
      State.modelOrder.shift();
      const s = State.modelCache.get(old);
      if (s) { disposeObject(s); State.modelCache.delete(old); }
    }
  }

  function disposeObject(obj) {
    obj.traverse(n => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) {
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        mats.forEach(m => {
          if (m.map) m.map.dispose();
          if (m.normalMap) m.normalMap.dispose();
          m.dispose();
        });
      }
    });
  }

  // Fallback recolorable blob for pets without a .glb (body + head), wrapped in
  // a group marked _isPrimitive so detachCurrent disposes it.
  function addPrimitive(pet) {
    const t = State.three; if (!t) return;
    const col = (pet.normalColors && pet.normalColors[0]) || '#7ac74f';
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(col), roughness: 0.7, metalness: 0.05 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 32, 24), mat);
    const headMat = mat.clone();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 32, 24), headMat);
    head.position.set(0, 0.6, 0.16);
    const wrap = new THREE.Group();
    wrap.userData._isPrimitive = true;
    wrap.add(body); wrap.add(head);
    t.group.add(wrap);
    t.recolorables = [mat, headMat];
    t.materialsByName = {}; // placeholder has no named submeshes → recolor cycles
  }

  function collectRecolorables(obj) {
    const t = State.three; if (!t) return;
    t.recolorables = [];
    t.materialsByName = {};
    obj.traverse(n => {
      if (n.isMesh && n.material) {
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        mats.forEach(m => {
          if (!m || !m.color) return;
          // Show single-sided meshes from both sides — fixes submeshes that
          // vanished when viewed from the "inside" (backface culling).
          m.side = THREE.DoubleSide;
          t.recolorables.push(m);
          // Remember the GLB's baked textures so a skin can revert to "Default".
          m.userData = m.userData || {};
          if (!m.userData._origCaptured) {
            m.userData._origMap = m.map || null;
            m.userData._origNormal = m.normalMap || null;
            m.userData._origCaptured = true;
          }
          // Index by material name so a color SLOT (exported with its Unity
          // material name) can recolor exactly its submesh — the glTF keeps
          // material names from Unity.
          const nm = (m.name || '').trim();
          if (nm) (t.materialsByName[nm] = t.materialsByName[nm] || []).push(m);
        });
      }
    });
  }

  function applyColors(colors) {
    const t = State.three;
    if (!t || !t.recolorables.length || !colors.length) return;
    t.recolorables.forEach((m, i) => {
      try { m.color.set(colors[i % colors.length]); } catch (e) {}
    });
  }

  // Paint each slot's NORMAL color onto its submesh (used on load so the pet
  // shows its normal look instead of the GLB's baked placeholder color).
  function applyNormalColors(pet) {
    if (!Array.isArray(pet.colorSlots) || !pet.colorSlots.length) return;
    applyByMaterial(pet.colorSlots.map(s => ({ material: s.material || '', color: s.normal || '#cccccc' })));
  }

  // ── Textures & skins ───────────────────────────────────────────────────────
  // A texture LAYER = { material, map, normal }. `material` targets a submesh by
  // its (Unity) material name; blank/"(all)" tints every recolorable material.
  // The color roll still multiplies over the texture, so textured pets recolor.
  function loadTex(url) {
    if (!url) return null;
    if (State.texCache[url]) return State.texCache[url];
    const tex = new THREE.TextureLoader().load(url);
    State.texCache[url] = tex;
    return tex;
  }

  function layerMaterials(layer) {
    const t = State.three; if (!t) return [];
    if (layer.material && layer.material !== '(all)') return t.materialsByName[layer.material] || [];
    return t.recolorables; // blank / "(all)" → every submesh
  }

  function applyLayer(layer) {
    const mats = layerMaterials(layer);
    mats.forEach(m => {
      if (layer.map) {
        const tx = loadTex(layer.map);
        if (tx) { if (THREE.sRGBEncoding !== undefined) tx.encoding = THREE.sRGBEncoding; m.map = tx; }
      }
      if (layer.normal) {
        const tn = loadTex(layer.normal);
        if (tn) m.normalMap = tn;
      }
      m.needsUpdate = true;
    });
  }

  function revertTextures() {
    const t = State.three; if (!t) return;
    t.recolorables.forEach(m => {
      if (!m.userData) return;
      m.map = m.userData._origMap || null;
      m.normalMap = m.userData._origNormal || null;
      m.needsUpdate = true;
    });
  }

  // Apply base texture slots, then the selected skin's layers on top.
  function applyTextureState(pet, skinName) {
    const t = State.three; if (!t || !t.recolorables.length) return;
    revertTextures();
    (pet.textureSlots || []).forEach(applyLayer);
    if (skinName && skinName !== '__default') {
      const sk = (pet.skins || []).find(s => s.name === skinName);
      if (sk) {
        if (Array.isArray(sk.layers)) sk.layers.forEach(applyLayer);
        else applyLayer(sk); // single-material skin { material, map, normal }
      }
    }
  }

  function skinOptions(pet) {
    const cur = State.skinByPet[pet.id] || '__default';
    let html = `<option value="__default"${cur === '__default' ? ' selected' : ''}>Default</option>`;
    (pet.skins || []).forEach(s => {
      html += `<option value="${escapeAttr(s.name)}"${cur === s.name ? ' selected' : ''}>${escapeHtml(s.name)}</option>`;
    });
    return html;
  }

  // ── Editor: textures & skins ───────────────────────────────────────────────
  function texMaterialOptions(pet, sel) {
    const uniq = Array.from(new Set((pet.colorSlots || []).map(s => s.material).filter(Boolean)));
    let html = `<option value="(all)"${(!sel || sel === '(all)') ? ' selected' : ''}>(all submeshes)</option>`;
    uniq.forEach(n => html += `<option value="${escapeAttr(n)}"${sel === n ? ' selected' : ''}>${escapeHtml(n)}</option>`);
    return html;
  }

  function openTexturesModal(id) {
    const pet = petById(id); if (!pet) return;
    pet.textureSlots = pet.textureSlots || [];
    pet.skins = pet.skins || [];
    showModal(`Textures & Skins — ${pet.name || pet.id}`, texModalBody(pet), async () => true, () => wireTexModal(pet));
    const foot = document.querySelector('#barkModal .bark-modal-foot');
    if (foot) {
      const s = foot.querySelector('#modalSave'); if (s) s.style.display = 'none';
      const c = foot.querySelector('#modalCancel'); if (c) c.textContent = 'Done';
    }
  }

  function texModalBody(pet) {
    const baseRows = (pet.textureSlots || []).map((ts, i) =>
      `<div class="cat-row tex-row"><span class="cat-name">${escapeHtml(ts.material || '(all)')}${ts.map ? ' · map' : ''}${ts.normal ? ' · normal' : ''}</span>
       <button type="button" class="edit-btn edit-btn-danger" data-rmbase="${i}">✕</button></div>`
    ).join('') || `<p class="pv-random" style="margin:4px 0;">No base textures.</p>`;

    const skinRows = (pet.skins || []).map((sk, i) =>
      `<div class="cat-row tex-row"><span class="cat-name">${escapeHtml(sk.name || 'skin')} → ${escapeHtml(sk.material || '(all)')}${sk.map ? ' · map' : ''}${sk.normal ? ' · normal' : ''}</span>
       <button type="button" class="edit-btn edit-btn-danger" data-rmskin="${i}">✕</button></div>`
    ).join('') || `<p class="pv-random" style="margin:4px 0;">No skins.</p>`;

    return `
      <p class="cat-hint">Apply an albedo (color) texture and/or normal map to a submesh — the simulate-spawn color still tints over it. Skins are named alternate textures shown in a dropdown on the pet.</p>
      <div class="cat-tree">
        <div class="tex-section-title">Base textures</div>
        ${baseRows}
        <div class="tex-add">
          <label>Submesh</label><select id="texBaseMat">${texMaterialOptions(pet, '(all)')}</select>
          <label>Color / albedo texture</label><input type="file" id="texBaseMap" accept="image/*" />
          <label>Normal map</label><input type="file" id="texBaseNormal" accept="image/*" />
          <button type="button" class="btn-secondary" id="texBaseAdd">+ Add base texture</button>
        </div>
        <div class="tex-section-title" style="margin-top:18px;">Skins</div>
        ${skinRows}
        <div class="tex-add">
          <label>Skin name</label><input id="texSkinName" placeholder="e.g. Galaxy" />
          <label>Submesh</label><select id="texSkinMat">${texMaterialOptions(pet, '(all)')}</select>
          <label>Color / albedo texture</label><input type="file" id="texSkinMap" accept="image/*" />
          <label>Normal map</label><input type="file" id="texSkinNormal" accept="image/*" />
          <button type="button" class="btn-secondary" id="texSkinAdd">+ Add skin</button>
        </div>
      </div>`;
  }

  function texRefresh(pet) {
    const body = document.querySelector('#barkModal .bark-modal-body');
    if (body) { body.innerHTML = texModalBody(pet); wireTexModal(pet); }
    BarkEditor.dirty = true; updateEditorBar();
    render(); // reloads the stage → re-applies textures + refreshes the skin dropdown
  }

  function wireTexModal(pet) {
    const body = document.querySelector('#barkModal .bark-modal-body'); if (!body) return;
    body.querySelectorAll('[data-rmbase]').forEach(b => b.onclick = () => { pet.textureSlots.splice(+b.dataset.rmbase, 1); texRefresh(pet); });
    body.querySelectorAll('[data-rmskin]').forEach(b => b.onclick = () => { pet.skins.splice(+b.dataset.rmskin, 1); texRefresh(pet); });

    const baseAdd = body.querySelector('#texBaseAdd');
    if (baseAdd) baseAdd.onclick = async () => {
      const mapF = body.querySelector('#texBaseMap').files[0];
      const nrmF = body.querySelector('#texBaseNormal').files[0];
      if (!mapF && !nrmF) return alert('Pick a texture and/or normal map.');
      const layer = { material: body.querySelector('#texBaseMat').value };
      try {
        showSpinner('Uploading texture…');
        if (mapF) layer.map = await uploadImage(mapF);
        if (nrmF) layer.normal = await uploadImage(nrmF);
      } catch (err) { alert('Upload failed: ' + err.message); hideSpinner(); return; }
      hideSpinner();
      pet.textureSlots.push(layer);
      texRefresh(pet);
    };

    const skinAdd = body.querySelector('#texSkinAdd');
    if (skinAdd) skinAdd.onclick = async () => {
      const name = (body.querySelector('#texSkinName').value || '').trim();
      const mapF = body.querySelector('#texSkinMap').files[0];
      const nrmF = body.querySelector('#texSkinNormal').files[0];
      if (!name) return alert('Name the skin.');
      if ((pet.skins || []).some(s => (s.name || '').toLowerCase() === name.toLowerCase())) return alert('A skin with that name already exists.');
      if (!mapF && !nrmF) return alert('Pick a texture and/or normal map for the skin.');
      const sk = { name, material: body.querySelector('#texSkinMat').value };
      try {
        showSpinner('Uploading skin…');
        if (mapF) sk.map = await uploadImage(mapF);
        if (nrmF) sk.normal = await uploadImage(nrmF);
      } catch (err) { alert('Upload failed: ' + err.message); hideSpinner(); return; }
      hideSpinner();
      pet.skins.push(sk);
      texRefresh(pet);
    };
  }

  // Center + frame the model: aim controls at its center and back the camera
  // off far enough to fit the bounding sphere.
  function frameGroup(pet) {
    const t = State.three; if (!t) return;
    // NORMALIZE: scale every model so its largest dimension is the same (~2
    // units). Pet prefabs vary in scale by 1000x, which — combined with the
    // OrbitControls min/maxDistance clamps — made some pets appear tiny/far and
    // others huge/too-close. After normalizing, one fixed framing works for all.
    // Per-pet rotation override (degrees) for prefabs authored sideways.
    const r = pet.modelRotation || [0, 0, 0];
    t.group.rotation.set(r[0] * Math.PI / 180, r[1] * Math.PI / 180, r[2] * Math.PI / 180);
    t.group.scale.setScalar(1);
    let box = new THREE.Box3().setFromObject(t.group);
    if (box.isEmpty()) return;
    let size = new THREE.Vector3(); box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    t.group.scale.setScalar((2 / maxDim) * (pet.modelScale || 1));

    box = new THREE.Box3().setFromObject(t.group);
    const center = new THREE.Vector3(); box.getCenter(center);
    box.getSize(size);
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    const fov = t.camera.fov * Math.PI / 180;
    const dist = (radius / Math.sin(fov / 2)) * 1.25;
    t.camera.near = Math.max(0.01, dist / 100);
    t.camera.far = dist * 100;
    t.camera.position.set(center.x, center.y + radius * 0.1, center.z + dist);
    t.camera.updateProjectionMatrix();
    if (t.controls) {
      t.controls.target.copy(center);
      t.controls.minDistance = dist * 0.25;   // scale clamps to THIS model
      t.controls.maxDistance = dist * 4;
      t.controls.update();
    }
  }

  // ── Mutations (breeding brace graph) ─────────────────────────────────────
  function renderMutationsFor(pet) {
    // Per-mutation visibility: editors see everything (hidden ones marked);
    // the public only sees mutations that aren't individually hidden.
    const vis = m => BarkEditor.editing || !m.hidden;
    const asResult = MUTS().filter(m => m.result === pet.id && vis(m));
    const asParent = MUTS().filter(m => (m.parentA === pet.id || m.parentB === pet.id) && vis(m));
    if (!asResult.length && !asParent.length) {
      return `<div class="pv-muts"><div class="pv-color-label">Mutations</div><p class="pv-random">None known.</p></div>`;
    }
    let html = `<div class="pv-muts"><div class="pv-color-label">Mutations</div>`;
    if (asResult.length) {
      html += `<div class="pv-mut-group"><span class="pv-mut-cap">How to breed ${escapeHtml(pet.name)}</span>`;
      asResult.forEach(m => html += mutationGraph(m));
      html += `</div>`;
    }
    if (asParent.length) {
      html += `<div class="pv-mut-group"><span class="pv-mut-cap">${escapeHtml(pet.name)} breeds into</span>`;
      asParent.forEach(m => html += mutationGraph(m));
      html += `</div>`;
    }
    return html + `</div>`;
  }

  // 2 parent circles (vertical) joined by a brace "}" → 1 result circle.
  function mutationGraph(m) {
    const a = petById(m.parentA), b = petById(m.parentB), r = petById(m.result);
    const node = (p, cx, cy, rad) => {
      const col = (p && p.normalColors && p.normalColors[0]) || '#888';
      const nm = (p && p.name) || (p && p.id) || '???';
      const ini = (nm.trim()[0] || '?').toUpperCase();
      return `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${escapeAttr(col)}" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/>
              <text x="${cx}" y="${cy + 5}" text-anchor="middle" class="pv-mg-ini">${escapeHtml(ini)}</text>
              <text x="${cx}" y="${cy + rad + 15}" text-anchor="middle" class="pv-mg-name">${escapeHtml(nm)}</text>`;
    };
    const svg = `<svg class="pv-mut-graph" viewBox="0 0 340 170" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      <path d="M70,48 Q150,48 165,85 Q150,122 70,122" fill="none" stroke="var(--accent)" stroke-width="2" opacity="0.75"/>
      <path d="M165,85 H248" fill="none" stroke="var(--accent)" stroke-width="2" opacity="0.75"/>
      <text x="206" y="79" text-anchor="middle" class="pv-mg-arrow">▶</text>
      ${node(a, 70, 48, 26)}
      ${node(b, 70, 122, 26)}
      ${node(r, 282, 85, 32)}
    </svg>`;
    // Editors see a marker on mutations that are hidden from the public.
    const tag = m.hidden ? `<span class="pv-hidden-badge">hidden from public</span>` : '';
    return `<div class="pv-mut-wrap">${tag}${svg}</div>`;
  }

  // ── Editor: add / edit / delete pet ──────────────────────────────────────
  function openPetModal(id) {
    const pets = PETS();
    const isNew = !id;
    const src = isNew
      ? { id: '', name: '', description: '', hidden: false, image: '', model: '', modelScale: 1, sounds: [], normalColors: [], naturalColors: 'random' }
      : { ...petById(id) };
    const e = { ...src, sounds: (src.sounds || []).slice() }; // own copy of sounds for safe edits
    const naturalRandom = e.naturalColors === 'random';

    showModal(`${isNew ? 'Add' : 'Edit'} pet`, `
      <label>Name</label>
      <input id="petName" value="${escapeAttr(e.name)}" placeholder="e.g. Sprout" />

      <label>Description</label>
      <textarea id="petDesc" rows="3">${escapeHtml(e.description || '')}</textarea>

      <label>3D model (.glb)${e.model ? ` — current: <code>${escapeHtml(e.model)}</code>` : ''}</label>
      <input type="file" id="petModelFile" accept=".glb,.gltf,model/gltf-binary" />

      <label>Model scale</label>
      <input id="petScale" type="number" step="0.1" value="${e.modelScale || 1}" />

      <label>Model rotation (degrees: X Y Z) — fix sideways pets here</label>
      <input id="petRot" value="${(e.modelRotation || [0,0,0]).join(' ')}" placeholder="0 0 0  (try '90 0 0' or '0 0 90')" />

      <label>Normal colors (comma-separated hex)</label>
      <input id="petNormal" value="${escapeAttr((e.normalColors || []).join(', '))}" placeholder="#6abe30, #3a7d1e" />

      <label class="pv-toggle"><input type="checkbox" id="petNatRandom" ${naturalRandom ? 'checked' : ''}/> Natural colors are random</label>
      <label>Natural color palette (comma-separated hex; ignored if random)</label>
      <input id="petNatural" value="${escapeAttr(naturalRandom ? '' : (e.naturalColors || []).join(', '))}" placeholder="#9aa0a6, #c0c0c0" />

      <label>Sounds</label>
      <div id="petSoundsList">${renderSoundRows(e.sounds)}</div>
      <input type="file" id="petSoundFile" accept="audio/*" />

      <label class="pv-toggle"><input type="checkbox" id="petHidden" ${e.hidden ? 'checked' : ''}/> Hidden from public</label>

      <label>URL slug (optional — auto-generated from name if blank)</label>
      <input id="petId" value="${escapeAttr(e.id)}" />
    `, async () => {
      const next = {
        id: (document.getElementById('petId').value.trim() || slugify(document.getElementById('petName').value)),
        name: document.getElementById('petName').value.trim(),
        description: document.getElementById('petDesc').value.trim(),
        hidden: document.getElementById('petHidden').checked,
        image: e.image || '',
        model: e.model || '',
        modelScale: parseFloat(document.getElementById('petScale').value) || 1,
        modelRotation: (document.getElementById('petRot').value || '0 0 0').trim().split(/[\s,]+/).map(function(n){return parseFloat(n)||0;}).slice(0,3),
        sounds: e.sounds.slice(),
        normalColors: parseHexList(document.getElementById('petNormal').value),
        naturalColors: document.getElementById('petNatRandom').checked
          ? 'random'
          : parseHexList(document.getElementById('petNatural').value),
      };
      if (!next.name) { alert('Name required'); return false; }

      const mf = document.getElementById('petModelFile').files[0];
      if (mf) {
        try { showSpinner('Uploading model…'); next.model = await uploadImage(mf); }
        catch (err) { alert('Model upload failed: ' + err.message); hideSpinner(); return false; }
        hideSpinner();
      }
      const sf = document.getElementById('petSoundFile').files[0];
      if (sf) {
        try { showSpinner('Uploading sound…'); next.sounds.push(await uploadImage(sf)); }
        catch (err) { alert('Sound upload failed: ' + err.message); hideSpinner(); return false; }
        hideSpinner();
      }

      if (isNew) pets.push(next);
      else pets[pets.findIndex(p => p.id === id)] = next;
      State.activeId = next.id;
      BarkEditor.dirty = true; updateEditorBar(); render();
      return true;
    });

    // Remove-sound buttons mutate the modal's own copy (e.sounds); committed on
    // Save. Re-wire from scratch after each removal so every button closes over
    // its own current index (not a stale one).
    const wireSoundRemoves = () => {
      const sl = document.getElementById('petSoundsList');
      if (!sl) return;
      sl.querySelectorAll('[data-rm]').forEach(btn => btn.onclick = () => {
        e.sounds.splice(+btn.dataset.rm, 1);
        sl.innerHTML = renderSoundRows(e.sounds);
        wireSoundRemoves();
      });
    };
    wireSoundRemoves();
  }

  function renderSoundRows(sounds) {
    if (!sounds || !sounds.length) return '<span class="pv-random">None yet.</span>';
    return sounds.map((s, i) =>
      `<div class="pv-sound-row"><code>${escapeHtml(s)}</code><button type="button" class="edit-btn edit-btn-danger" data-rm="${i}">✕</button></div>`
    ).join('');
  }

  function deletePet(id) {
    const p = petById(id); if (!p) return;
    if (!confirm(`Delete pet "${p.name || id}"? Mutations referencing it are removed too.`)) return;
    BarkEditor.data.pets = PETS().filter(x => x.id !== id);
    BarkEditor.data.mutations = MUTS().filter(m => m.parentA !== id && m.parentB !== id && m.result !== id);
    if (State.activeId === id) State.activeId = null;
    BarkEditor.dirty = true; updateEditorBar(); render();
  }

  // ── Editor: manage mutations ─────────────────────────────────────────────
  function openMutationsModal() {
    showModal('Mutations', mutModalBody(), async () => true, () => wireMutModal());
    const foot = document.querySelector('#barkModal .bark-modal-foot');
    if (foot) {
      const s = foot.querySelector('#modalSave'); if (s) s.style.display = 'none';
      const c = foot.querySelector('#modalCancel'); if (c) c.textContent = 'Done';
    }
  }

  function petOptions(sel) {
    return PETS().map(p => `<option value="${escapeAttr(p.id)}"${p.id === sel ? ' selected' : ''}>${escapeHtml(p.name || p.id)}</option>`).join('');
  }

  function mutModalBody() {
    const muts = MUTS();
    const nm = id => { const p = petById(id); return p ? escapeHtml(p.name || id) : `<i>${escapeHtml(id || '?')}</i>`; };
    let html = `<p class="cat-hint">Breeding combos: two parents → one result. Shown on each pet when "Mutations public" is on.</p><div class="cat-tree">`;
    if (!muts.length) html += `<p class="players-empty" style="margin:6px 0 10px;">No mutations yet.</p>`;
    muts.forEach((m, i) => {
      html += `<div class="cat-node"><div class="cat-row">
        <span class="cat-name">${nm(m.parentA)} + ${nm(m.parentB)} → ${nm(m.result)}${m.hidden ? ' <span class="pv-hidden-badge">hidden</span>' : ''}</span>
        <span class="cat-actions">
          <button type="button" class="edit-btn" data-hide="${i}" title="${m.hidden ? 'Show to public' : 'Hide from public'}">${m.hidden ? '🙈' : '👁'}</button>
          <button type="button" class="edit-btn edit-btn-danger" data-del="${i}">✕</button>
        </span>
      </div></div>`;
    });
    html += `</div>
      <div class="pv-mut-add">
        <label>Parent A</label><select id="mutA">${petOptions()}</select>
        <label>Parent B</label><select id="mutB">${petOptions()}</select>
        <label>Result</label><select id="mutR">${petOptions()}</select>
        <button type="button" class="btn-secondary cat-add-top" id="mutAdd">+ Add mutation</button>
      </div>`;
    return html;
  }

  function wireMutModal() {
    const body = document.querySelector('#barkModal .bark-modal-body');
    if (!body) return;
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { MUTS().splice(+b.dataset.del, 1); mutRefresh(); });
    body.querySelectorAll('[data-hide]').forEach(b => b.onclick = () => {
      const m = MUTS()[+b.dataset.hide]; if (m) m.hidden = !m.hidden; mutRefresh();
    });
    const add = body.querySelector('#mutAdd');
    if (add) add.onclick = () => {
      const a = body.querySelector('#mutA').value;
      const b = body.querySelector('#mutB').value;
      const r = body.querySelector('#mutR').value;
      if (!a || !b || !r) return alert('Pick parent A, parent B, and a result.');
      MUTS().push({ id: 'mut-' + Date.now().toString(36), parentA: a, parentB: b, result: r, note: '' });
      mutRefresh();
    };
  }

  function mutRefresh() {
    const body = document.querySelector('#barkModal .bark-modal-body');
    if (body) { body.innerHTML = mutModalBody(); wireMutModal(); }
    BarkEditor.dirty = true; updateEditorBar(); render();
  }

  // Expose for editor.js (called when the "Extra Info" tab is shown / on re-render).
  window.BarkPets = { render, _state: State };
})();
