// indexviewer.js — the 3D models on the Index (items + cosmetics).
// ---------------------------------------------------------------------------
// The models come straight out of Unity (Bark → Website → Export Index writes one .glb per item and
// cosmetic), so the Index shows what is actually in the game without anybody taking screenshots.
//
// CARDS: every <canvas class="db-card-model" data-model="..."> gets ONE still render, drawn when it
// scrolls into view, by a single shared WebGL renderer (a page of cards must never open a WebGL
// context each - browsers keep 8-16 and silently kill the oldest; see pumpkins.js). The GPU copy is
// thrown away as soon as the picture is drawn, so scrolling the whole Index costs no memory.
//
// DETAIL: <canvas class="db-detail-model" data-model="..."> in the popup gets a live view you can
// drag round, slowly turning by itself, and is released when the popup closes.
//
// editor.js only writes those canvases; this file finds them itself (MutationObserver), so the two
// never have to load in a particular order. 🍍
// ---------------------------------------------------------------------------
(function () {
  'use strict';
  if (typeof THREE === 'undefined' || !THREE.GLTFLoader) {
    console.warn('[indexviewer] three.js / GLTFLoader missing - the Index shows pictures only.');
    return;
  }

  const version = () => {
    const d = window.BarkEditor && window.BarkEditor.data;
    return d && d.modelsVersion ? '?v=' + d.modelsVersion : '';
  };

  // ── The stage: lights and a camera that frames whatever it is given ────────────────────────

  function makeStage() {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff4e6, 0x2a1a10, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(1.5, 2.5, -2);          // from the FRONT: the exporter's flip puts a Unity model's front on -Z
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffc89a, 0.45);
    rim.position.set(-2, 1, 2);
    scene.add(rim);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.001, 100);
    return { scene, cam };
  }

  /// Centre the model on the origin and put the camera three-quarters on from the front, far enough
  /// back that the whole thing fits whichever way it is turned.
  function frame(model, cam, aspect) {
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return 1;
    const c = box.getCenter(new THREE.Vector3());
    model.position.sub(c);
    const r = Math.max(1e-4, box.getSize(new THREE.Vector3()).length() * 0.5);
    const fov = cam.fov * Math.PI / 180;
    const dist = r / Math.sin(Math.min(fov, fov * aspect) / 2) * 1.02;
    const dir = new THREE.Vector3(0.55, 0.38, -1).normalize();
    cam.position.copy(dir.multiplyScalar(dist));
    cam.near = dist / 100; cam.far = dist * 10;
    cam.aspect = aspect;
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    return r;
  }

  function dispose(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
        m.dispose();
      }
    });
  }

  function tidyMaterials(model) {
    model.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m) { m.side = THREE.DoubleSide; if (m.map) m.map.anisotropy = 4; }
    });
  }

  const loader = new THREE.GLTFLoader();
  const load = (url) => new Promise((ok, fail) => loader.load(url + version(), (g) => ok(g.scene), undefined, fail));

  // ── Card thumbnails ─────────────────────────────────────────────────────────────────────────

  let shared = null, stage = null;
  function renderer() {
    if (!shared) {
      shared = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      shared.setPixelRatio(1);
      if (THREE.sRGBEncoding !== undefined) shared.outputEncoding = THREE.sRGBEncoding;
      stage = makeStage();
    }
    return shared;
  }

  const queue = [];
  let busy = 0;
  const MAX_AT_ONCE = 3;

  function pump() {
    while (busy < MAX_AT_ONCE && queue.length) {
      const canvas = queue.shift();
      if (!canvas.isConnected || canvas.dataset.drawn) continue;
      busy++;
      drawThumb(canvas).catch(() => { canvas.dataset.failed = '1'; canvas.classList.add('db-model-failed'); })
                       .finally(() => { busy--; pump(); });
    }
  }

  async function drawThumb(canvas) {
    const url = canvas.dataset.model;
    const model = await load(url);
    if (!canvas.isConnected) { dispose(model); return; }
    tidyMaterials(model);

    const r = renderer();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(64, Math.round(canvas.clientWidth * dpr)), h = Math.max(64, Math.round(canvas.clientHeight * dpr));
    r.setSize(w, h, false);
    stage.scene.add(model);
    frame(model, stage.cam, w / h);
    r.render(stage.scene, stage.cam);
    stage.scene.remove(model);
    dispose(model);

    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(r.domElement, 0, 0, w, h);
    canvas.dataset.drawn = '1';
    canvas.classList.add('db-model-ready');
  }

  const seen = typeof IntersectionObserver === 'undefined' ? null
    : new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          seen.unobserve(e.target);
          queue.push(e.target);
        }
        pump();
      }, { rootMargin: '300px' });

  function watchThumb(canvas) {
    if (canvas.dataset.watched) return;
    canvas.dataset.watched = '1';
    if (seen) seen.observe(canvas); else { queue.push(canvas); pump(); }
  }

  // ── The detail view ─────────────────────────────────────────────────────────────────────────

  function openDetail(canvas) {
    if (canvas.dataset.watched) return;
    canvas.dataset.watched = '1';
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (THREE.sRGBEncoding !== undefined) r.outputEncoding = THREE.sRGBEncoding;
    const st = makeStage();
    let controls = null, model = null, alive = true, raf = 0;

    const size = () => {
      const w = canvas.clientWidth | 0, h = canvas.clientHeight | 0;
      if (w > 1 && h > 1 && (canvas.width !== Math.round(w * r.getPixelRatio()) || canvas.height !== Math.round(h * r.getPixelRatio()))) {
        r.setSize(w, h, false);
        st.cam.aspect = w / h;
        st.cam.updateProjectionMatrix();
      }
    };

    load(canvas.dataset.model).then((m) => {
      if (!alive) { dispose(m); return; }
      model = m;
      tidyMaterials(model);
      st.scene.add(model);
      size();
      frame(model, st.cam, (canvas.clientWidth || 1) / (canvas.clientHeight || 1));
      if (THREE.OrbitControls) {
        controls = new THREE.OrbitControls(st.cam, canvas);
        controls.enablePan = false;
        controls.enableDamping = true;
        controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        controls.autoRotateSpeed = 1.6;
        const d = st.cam.position.length();
        controls.minDistance = d * 0.35; controls.maxDistance = d * 2.5;
      }
      canvas.classList.add('db-model-ready');
    }).catch(() => canvas.classList.add('db-model-failed'));

    const tick = () => {
      if (!canvas.isConnected) { stop(); return; }
      size();
      if (controls) controls.update();
      r.render(st.scene, st.cam);
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      alive = false;
      cancelAnimationFrame(raf);
      if (controls) controls.dispose();
      if (model) dispose(model);
      r.dispose();
      if (r.forceContextLoss) r.forceContextLoss();
    };
    raf = requestAnimationFrame(tick);
  }

  // ── Finding the canvases ────────────────────────────────────────────────────────────────────

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('canvas.db-card-model[data-model]').forEach(watchThumb);
    root.querySelectorAll('canvas.db-detail-model[data-model]').forEach(openDetail);
  }
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) {
      if (n.matches && n.matches('canvas.db-card-model[data-model]')) watchThumb(n);
      else if (n.matches && n.matches('canvas.db-detail-model[data-model]')) openDetail(n);
      else scan(n);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  scan(document);
})();
