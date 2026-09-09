// pumpkins.js — BARK carved pumpkin gallery
// ---------------------------------------------------------------------------
// Every pumpkin here is REBUILT, not photographed. The backend stores a carve as
// the pumpkin's shape numbers plus every point somebody placed with the knife or
// the scraper — about 1.4KB — and this file runs the same maths the game runs to
// turn that back into geometry. So the thing you drag around is the actual
// pumpkin somebody carved, at whatever resolution your screen wants, and it can
// never fall out of date with a thumbnail that was rendered once.
//
// Kept deliberately in step with Assets/Scripts/Pumpkins/PumpkinGenerator.cs and
// PumpkinCarveMesh.cs. If the silhouette or the groove is tuned there, it has to
// be tuned here too — that is the price of not shipping images, and it is worth
// it. The functions are named the same on purpose so the two can be diffed.
//
// ONE SIMPLIFICATION against the game: a scrape is a vertex colour here rather
// than a baked 1024 texture. The game needs the texture because a scraped letter
// is millimetres wide on something held to your face; a gallery card is 300px,
// and a browser can afford the extra tessellation instead.
//
// Three.js r128 UMD is loaded from CDN by the page. Everything degrades to a
// plain message if it is absent. 🍍
// ---------------------------------------------------------------------------
(function () {
  'use strict';

  let BACKEND = null;

  async function resolveBackend() {
    try {
      const r = await fetch('backend-url.json?t=' + Date.now());
      const j = await r.json();
      if (j && j.backendUrl) BACKEND = String(j.backendUrl).replace(/\/$/, '');
    } catch (e) {
      console.warn('[pumpkins] backend-url.json failed:', e.message);
    }
    return BACKEND;
  }

  // ── The pumpkin surface — mirrors PumpkinGenerator.cs ─────────────────────

  function hash01(seed, k) {
    let h = (Math.imul(seed, 374761393) + Math.imul(k, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
    return ((h ^ (h >>> 16)) & 0x7fffffff) / 0x7fffffff;
  }

  // Narrow crease, broad lobe — with the angle warped and the depth modulated so
  // the ribs are not all identical. Every term is periodic over a full turn or
  // the ribbing would fail to meet itself at the seam.
  function groove(s, theta) {
    const plain = Math.pow((Math.cos(s.lobes * theta) + 1) * 0.5, s.ribSharpness);
    const irr = Math.min(1, Math.max(0, s.ribIrregularity || 0));
    if (irr <= 0.001) return plain;

    let w = 0;
    for (let k = 1; k <= 3; k++)
      w += (hash01(s.ribSeed | 0, k) - 0.5) *
           Math.sin(k * theta + hash01(s.ribSeed | 0, k + 32) * Math.PI * 2) / k;

    const warped = theta + w * irr * (1.2 * Math.PI / Math.max(1, s.lobes));
    const g = Math.pow((Math.cos(s.lobes * warped) + 1) * 0.5, s.ribSharpness);

    let depthMod = 1;
    for (let k = 1; k <= 2; k++)
      depthMod += (hash01(s.ribSeed | 0, k + 64) - 0.5) * irr * 0.55 *
                  Math.sin(k * theta + hash01(s.ribSeed | 0, k + 96) * Math.PI * 2);

    return g * Math.min(1.6, Math.max(0.25, depthMod));
  }

  function smoothstep01(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }

  function surfacePoint(s, u01, v01) {
    const halfH = s.height * 0.5, maxR = s.width * 0.5;
    const v = Math.min(1, Math.max(0, v01));
    const u = -1 + 2 * v;

    let profile = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), s.flatten)), 1 / s.flatten);
    const bw = s.bottomWidth > 0 ? s.bottomWidth : 1;
    const tw = s.topWidth > 0 ? s.topWidth : 1;
    profile *= bw + (tw - bw) * smoothstep01(v);

    let y = u * halfH;
    const dimple = smoothstep01((v - 0.72) / (1 - 0.72));
    y -= dimple * s.topDimple * s.height;

    const theta = u01 * Math.PI * 2;
    const rad = maxR * profile * (1 - s.ribDepth * groove(s, theta));
    return [Math.cos(theta) * rad, y, Math.sin(theta) * rad];
  }

  // Numerical, like the game's — the closed form is long and easy to get subtly
  // wrong, and a wrong normal shows up as an uneven wall rather than as a bug.
  function surfaceNormal(s, u01, v01) {
    const e = 1e-3;
    const p = surfacePoint(s, u01, v01);
    const a = surfacePoint(s, u01 + e, v01), b = surfacePoint(s, u01 - e, v01);
    const c = surfacePoint(s, u01, Math.min(1, v01 + e)), d = surfacePoint(s, u01, Math.max(0, v01 - e));

    let du = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let dv = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
    du = norm3(du); dv = norm3(dv);

    let n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
    if (n[0] * n[0] + n[1] * n[1] + n[2] * n[2] < 1e-8) n = [p[0], 0, p[2]];
    n = norm3(n);
    if (n[0] * p[0] + n[1] * p[1] + n[2] * p[2] < 0) n = [-n[0], -n[1], -n[2]];
    return n;
  }

  function norm3(v) {
    const m = Math.hypot(v[0], v[1], v[2]);
    return m < 1e-9 ? [0, 1, 0] : [v[0] / m, v[1] / m, v[2] / m];
  }

  function cavityPoint(s, u01, v01, wall) {
    const p = surfacePoint(s, u01, v01);
    const n = surfaceNormal(s, u01, v01);
    const reach = Math.max(0.02, Math.hypot(p[0], p[2]));
    const d = Math.min(wall, reach * 0.75);
    return [p[0] - n[0] * d, p[1] - n[1] * d, p[2] - n[2] * d];
  }

  // ── Where the tools have been — mirrors PumpkinCarveQuery ─────────────────

  function unwrapU(st) {
    const n = Math.min(st.u.length, st.v.length);
    const uu = new Array(n);
    if (!n) return uu;
    uu[0] = st.u[0];
    for (let i = 1; i < n; i++) {
      let d = st.u[i] - st.u[i - 1];
      d -= Math.round(d);                 // shortest way round, in turns
      uu[i] = uu[i - 1] + d;
    }
    return uu;
  }

  function insidePolygon(st, uu, wrap, pu, pv) {
    let inside = false;
    const n = Math.min(st.u.length, st.v.length);
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = uu[i] + wrap, yi = st.v[i];
      const xj = uu[j] + wrap, yj = st.v[j];
      if ((yi > pv) !== (yj > pv) && pu < ((xj - xi) * (pv - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function nearPolyline(st, uu, wrap, pu, pv, r) {
    const r2 = Math.max(1e-6, r * r);
    const n = Math.min(st.u.length, st.v.length);
    for (let i = 0; i + 1 < n; i++) {
      const ax = uu[i] + wrap, ay = st.v[i];
      const bx = uu[i + 1] + wrap, by = st.v[i + 1];
      const abx = bx - ax, aby = by - ay;
      const len2 = abx * abx + aby * aby;
      let t = len2 < 1e-12 ? 0 : ((pu - ax) * abx + (pv - ay) * aby) / len2;
      t = Math.min(1, Math.max(0, t));
      const dx = pu - (ax + abx * t), dy = pv - (ay + aby * t);
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  }

  // u wraps: a stroke round the back straddles 0 and 1, so all three offsets are tried.
  function strokeHits(st, uu, pu, pv) {
    for (let wrap = -1; wrap <= 1; wrap++) {
      if (st.closed) { if (insidePolygon(st, uu, wrap, pu, pv)) return true; }
      else if (nearPolyline(st, uu, wrap, pu, pv, (st.width || 0.02) * 0.5)) return true;
    }
    return false;
  }

  function prepStrokes(carve) {
    return (carve.strokes || [])
      .filter((st) => st && st.u && st.v && Math.min(st.u.length, st.v.length) >= 2)
      .map((st) => ({ st, uu: unwrapU(st) }));
  }

  function isCut(prepped, pu, pv) {
    for (const { st, uu } of prepped)
      if (st.tool === 0 && strokeHits(st, uu, pu, pv)) return true;
    return false;
  }

  function scrapeDepth(prepped, pu, pv) {
    let best = 0;
    for (const { st, uu } of prepped)
      if (st.tool === 1 && strokeHits(st, uu, pu, pv))
        best = Math.max(best, Math.min(1, Math.max(0, st.depth == null ? 0.6 : st.depth)));
    return best;
  }

  // ── Build the mesh — mirrors PumpkinCarveMesh ─────────────────────────────

  // ── The pumpkin palette, mirrored from PumpkinGenerator.BodyColor ────────────────────────────
  //
  // The skin colour used to be one hardcoded orange, so every pumpkin in the gallery came out the
  // same regardless of what was actually carved. A pale gourd and a deep orange pumpkin are the same
  // fruit here, which rather undermines the point of a gallery.
  //
  // The carve file already carries shape.colorIndex — the game has always sent it, the website just
  // was not reading it. These are the twelve entries the game generates, converted to sRGB.
  const BODY_COLORS = [
    [0.937, 0.651, 0.333], [0.898, 0.592, 0.294], [0.961, 0.714, 0.412],
    [0.922, 0.694, 0.396], [0.953, 0.796, 0.486], [0.965, 0.867, 0.584],
    [0.949, 0.906, 0.769], [0.965, 0.945, 0.886], [0.929, 0.918, 0.855],
    [0.816, 0.831, 0.678], [0.694, 0.737, 0.565], [0.769, 0.565, 0.396],
  ];
  function bodyColor(carve) {
    const i = carve && carve.shape ? (carve.shape.colorIndex | 0) : 0;
    return BODY_COLORS[((i % BODY_COLORS.length) + BODY_COLORS.length) % BODY_COLORS.length];
  }
  const FLESH = [0.95, 0.86, 0.55];

  function buildPumpkin(carve) {
    const s = carve.shape;
    const prepped = prepStrokes(carve);
    const anyCut = prepped.some((p) => p.st.tool === 0);

    const rings = 44, segs = Math.max(72, Math.round(s.lobes * 8));
    const wall = Math.min(0.09, Math.max(0.012, s.height * 0.11));

    const pos = [], nor = [], col = [];
    const SKIN = bodyColor(carve);          // this pumpkin's own colour, not a fixed orange

    const push = (p, n, c) => {
      pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); col.push(c[0], c[1], c[2]);
    };

    const skinAt = (u, v) => {
      const d = scrapeDepth(prepped, u, v);
      const n = surfaceNormal(s, u, v);
      const p = surfacePoint(s, u, v);
      const inset = d * 0.85 * wall;
      const t = smoothstep01((d - 0.04) / 0.18);
      const c = [
        SKIN[0] + (FLESH[0] - SKIN[0]) * t,
        SKIN[1] + (FLESH[1] - SKIN[1]) * t,
        SKIN[2] + (FLESH[2] - SKIN[2]) * t,
      ];
      return { p: [p[0] - n[0] * inset, p[1] - n[1] * inset, p[2] - n[2] * inset], n, c };
    };

    // Bisect to the cut edge, exactly as the game does, so the hole follows the
    // polygon somebody drew rather than the tessellation.
    const crossing = (ku, kv, cu, cv) => {
      for (let i = 0; i < 6; i++) {
        const mu = (ku + cu) * 0.5, mv = (kv + cv) * 0.5;
        if (isCut(prepped, mu, mv)) { cu = mu; cv = mv; } else { ku = mu; kv = mv; }
      }
      return [(ku + cu) * 0.5, (kv + cv) * 0.5];
    };

    for (let r = 0; r < rings; r++) {
      const v0 = r / rings, v1 = (r + 1) / rings;
      for (let c = 0; c < segs; c++) {
        const u0 = c / segs, u1 = (c + 1) / segs;
        const corner = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
        const keep = corner.map((q) => !isCut(prepped, q[0], q[1]));

        const poly = [], cross = [];
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) & 3;
          if (keep[i]) poly.push(corner[i]);
          if (keep[i] !== keep[j]) {
            const a = keep[i] ? corner[i] : corner[j];
            const b = keep[i] ? corner[j] : corner[i];
            const x = crossing(a[0], a[1], b[0], b[1]);
            poly.push(x); cross.push(x);
          }
        }

        // The wall of the cut — the piece that makes it read as thickness.
        for (let i = 0; i + 1 < cross.length; i += 2) {
          const A = cross[i], B = cross[i + 1];
          const oA = surfacePoint(s, A[0], A[1]), oB = surfacePoint(s, B[0], B[1]);
          const iA = cavityPoint(s, A[0], A[1], wall), iB = cavityPoint(s, B[0], B[1], wall);
          const e1 = [oB[0] - oA[0], oB[1] - oA[1], oB[2] - oA[2]];
          const e2 = [iA[0] - oA[0], iA[1] - oA[1], iA[2] - oA[2]];
          let n = norm3([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]);
          // Both windings: a rim is seen from inside the pumpkin as well as outside.
          for (const tri of [[oA, oB, iB], [oA, iB, iA], [oA, iB, oB], [oA, iA, iB]])
            for (const p of tri) push(p, n, FLESH);
        }

        if (poly.length < 3) continue;
        // Wound against the walk order: u maps to theta and v to +y, which
        // reverses handedness, so fanning in walk order faces inward.
        const vs = poly.map((q) => skinAt(q[0], q[1]));
        for (let i = 1; i + 1 < vs.length; i++) {
          push(vs[0].p, vs[0].n, vs[0].c);
          push(vs[i + 1].p, vs[i + 1].n, vs[i + 1].c);
          push(vs[i].p, vs[i].n, vs[i].c);
        }
      }
    }

    if (anyCut) {
      const dark = [FLESH[0] * 0.55, FLESH[1] * 0.55, FLESH[2] * 0.55];
      for (let r = 0; r < rings; r++) {
        const v0 = r / rings, v1 = (r + 1) / rings;
        for (let c = 0; c < segs; c++) {
          const u0 = c / segs, u1 = (c + 1) / segs;
          if (isCut(prepped, (u0 + u1) * 0.5, (v0 + v1) * 0.5)) continue;
          const a = cavityPoint(s, u0, v0, wall), b = cavityPoint(s, u1, v0, wall);
          const d = cavityPoint(s, u0, v1, wall), e = cavityPoint(s, u1, v1, wall);
          const na = surfaceNormal(s, u0, v0).map((x) => -x);
          for (const p of [a, b, d, b, e, d]) push(p, na, dark);
        }
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }

  // ── Cards ────────────────────────────────────────────────────────────────

  const viewers = [];

  function makeViewer(canvas, carve) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 50);

    const geo = buildPumpkin(carve);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xfff0dd, 1.15);
    key.position.set(2, 3, 2.5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.35);
    rim.position.set(-2, 1, -2);
    scene.add(rim);

    const radius = geo.boundingSphere ? geo.boundingSphere.radius : 0.4;
    cam.position.set(0, radius * 0.25, radius * 3.6);
    cam.lookAt(0, 0, 0);

    let spin = 0, dragging = false, lastX = 0, auto = true;
    canvas.addEventListener('pointerdown', (e) => { dragging = true; auto = false; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (dragging) { spin += (e.clientX - lastX) * 0.01; lastX = e.clientX; } });
    canvas.addEventListener('pointerup',   (e) => { dragging = false; try { canvas.releasePointerCapture(e.pointerId); } catch (_) {} });

    return {
      tick(dt) {
        if (auto) spin += dt * 0.35;
        mesh.rotation.y = spin;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (canvas.width !== w || canvas.height !== h) {
          renderer.setSize(w, h, false);
          cam.aspect = w / Math.max(1, h);
          cam.updateProjectionMatrix();
        }
        renderer.render(scene, cam);
      },
    };
  }

  let last = performance.now();
  function animate() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const v of viewers) v.tick(dt);
    requestAnimationFrame(animate);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function load() {
    const grid = document.getElementById('pumpkin-grid');
    const status = document.getElementById('pumpkin-status');
    if (!grid) return;

    if (typeof THREE === 'undefined') {
      status.textContent = '3D viewer unavailable (Three.js did not load).';
      return;
    }

    await resolveBackend();
    if (!BACKEND) { status.textContent = 'Backend offline.'; return; }

    let list = [];
    try {
      const r = await fetch(`${BACKEND}/api/pumpkins/public?limit=60`);
      const j = await r.json();
      list = (j && j.pumpkins) || [];
    } catch (e) {
      status.textContent = 'Could not reach the gallery: ' + e.message;
      return;
    }

    if (!list.length) { status.textContent = 'No pumpkins have been carved yet.'; return; }
    status.textContent = `${list.length} carved pumpkin${list.length === 1 ? '' : 's'}.`;

    for (const rec of list) {
      const card = document.createElement('div');
      card.className = 'pump-card';
      card.innerHTML =
        `<canvas class="pump-canvas"></canvas>` +
        `<div class="pump-meta"><strong>${esc(rec.artist || 'Someone')}</strong><br>` +
        `${rec.strokes || 0} cut${rec.strokes === 1 ? '' : 's'} · ` +
        `${new Date(rec.createdAt || Date.now()).toLocaleDateString()}</div>`;
      grid.appendChild(card);

      // One fetch per card, lazily — a carve is ~1.4KB, so sixty of them is
      // still smaller than a single painting thumbnail.
      try {
        const cr = await fetch(`${BACKEND}/pumpkins/${rec.id}.json`);
        const carve = await cr.json();
        if (!carve || !carve.shape) throw new Error('bad carve');
        viewers.push(makeViewer(card.querySelector('.pump-canvas'), carve));
      } catch (e) {
        card.querySelector('.pump-meta').innerHTML += '<br><em>could not load</em>';
      }
    }

    animate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
