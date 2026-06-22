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

  const State = { activeId: null, three: null, audio: null, loadToken: 0, resizeHooked: false };

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
        el.onclick = () => { State.activeId = p.id; render(); };
        list.appendChild(el);
      });
    }

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
        <div class="pv-controls">
          <button class="btn-secondary" id="pvSpawn">🎲 Simulate spawn</button>
          <button class="btn-secondary" id="pvSound" ${hasSound ? '' : 'disabled'}>🔊 Test sound</button>
          ${editing ? `
            <button class="btn-secondary" id="pvEdit">✎ Edit</button>
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
    if (editing) {
      stage.querySelector('#pvEdit').onclick = () => openPetModal(pet.id);
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

  function simulateSpawn(pet) {
    const rolled = rollColors(pet);
    applyColors(rolled);
    const el = document.getElementById('pvRolled');
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

    State.three = { wrap, renderer, scene, camera, controls, group, recolorables: [], raf: 0 };
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

  function clearGroup() {
    const t = State.three; if (!t) return;
    while (t.group.children.length) t.group.remove(t.group.children[0]);
    t.recolorables = [];
  }

  function loadModel(pet) {
    const t = State.three; if (!t) return;
    clearGroup();
    const token = ++State.loadToken;

    if (pet.model && THREE.GLTFLoader) {
      new THREE.GLTFLoader().load(
        pet.model,
        (gltf) => {
          if (!State.three || token !== State.loadToken) return; // superseded by a newer selection
          const obj = gltf.scene || (gltf.scenes && gltf.scenes[0]);
          if (!obj) { addPrimitive(pet); frameGroup(pet); return; }
          collectRecolorables(obj);
          t.group.add(obj);
          frameGroup(pet);
        },
        undefined,
        (err) => {
          if (token !== State.loadToken) return;
          console.warn('[petviewer] model load failed:', pet.model, err);
          addPrimitive(pet); frameGroup(pet);
        }
      );
    } else {
      addPrimitive(pet);
      frameGroup(pet);
    }
  }

  // Fallback recolorable blob for pets without a .glb yet (body + head).
  function addPrimitive(pet) {
    const t = State.three; if (!t) return;
    const col = (pet.normalColors && pet.normalColors[0]) || '#7ac74f';
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(col), roughness: 0.7, metalness: 0.05 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 32, 24), mat);
    const headMat = mat.clone();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 32, 24), headMat);
    head.position.set(0, 0.6, 0.16);
    t.group.add(body); t.group.add(head);
    t.recolorables = [mat, headMat];
  }

  function collectRecolorables(obj) {
    const t = State.three; if (!t) return;
    t.recolorables = [];
    obj.traverse(n => {
      if (n.isMesh && n.material) {
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        mats.forEach(m => { if (m && m.color) t.recolorables.push(m); });
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

  // Center + frame the model: aim controls at its center and back the camera
  // off far enough to fit the bounding sphere.
  function frameGroup(pet) {
    const t = State.three; if (!t) return;
    t.group.scale.setScalar(pet.modelScale || 1);
    const box = new THREE.Box3().setFromObject(t.group);
    if (box.isEmpty()) return;
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    const fov = t.camera.fov * Math.PI / 180;
    const dist = (radius / Math.sin(fov / 2)) * 1.4;
    t.camera.near = Math.max(0.001, dist / 100);
    t.camera.far = dist * 100;
    t.camera.position.set(center.x, center.y + radius * 0.15, center.z + dist);
    t.camera.updateProjectionMatrix();
    if (t.controls) { t.controls.target.copy(center); t.controls.update(); }
  }

  // ── Mutations (breeding brace graph) ─────────────────────────────────────
  function renderMutationsFor(pet) {
    const asResult = MUTS().filter(m => m.result === pet.id);
    const asParent = MUTS().filter(m => m.parentA === pet.id || m.parentB === pet.id);
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
    return `<svg class="pv-mut-graph" viewBox="0 0 340 170" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      <path d="M70,48 Q150,48 165,85 Q150,122 70,122" fill="none" stroke="var(--accent)" stroke-width="2" opacity="0.75"/>
      <path d="M165,85 H248" fill="none" stroke="var(--accent)" stroke-width="2" opacity="0.75"/>
      <text x="206" y="79" text-anchor="middle" class="pv-mg-arrow">▶</text>
      ${node(a, 70, 48, 26)}
      ${node(b, 70, 122, 26)}
      ${node(r, 282, 85, 32)}
    </svg>`;
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

    // Remove-sound buttons mutate the modal's own copy (e.sounds); committed on Save.
    const sl = document.getElementById('petSoundsList');
    if (sl) sl.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
      e.sounds.splice(+b.dataset.rm, 1);
      sl.innerHTML = renderSoundRows(e.sounds);
      sl.querySelectorAll('[data-rm]').forEach(b2 => b2.onclick = b.onclick); // re-wire (simple)
    });
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
        <span class="cat-name">${nm(m.parentA)} + ${nm(m.parentB)} → ${nm(m.result)}</span>
        <span class="cat-actions"><button type="button" class="edit-btn edit-btn-danger" data-del="${i}">✕</button></span>
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
  window.BarkPets = { render };
})();
