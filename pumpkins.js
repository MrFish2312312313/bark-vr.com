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
// The skin is baked exactly as PumpkinCarveSkin bakes it (same 512 size, same mask, same blur,
// same dark rim), and every colour is lit the way the game's materials light it - see
// gameAlbedo. The palette numbers are sRGB, not linear; getting that wrong is what made the
// gallery pale.
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

    // ── MIRRORED, BECAUSE UNITY AND THREE.JS DISAGREE ON HANDEDNESS ────────
    //
    // The game is LEFT-handed (+Z away from you); three.js is RIGHT-handed
    // (+Z toward you). The formula below is character-for-character the game's,
    // so feeding it the same numbers builds the same pumpkin INSIDE OUT about
    // the XY plane: the face lands round the back and any text reads mirrored.
    // Negating Z converts between the two conventions.
    //
    // Safe to do here rather than at every call site: surfaceNormal derives
    // from this function and forces itself outward, and cavityPoint derives
    // from both, so the whole surface mirrors together.
    const theta = u01 * Math.PI * 2;
    const rad = maxR * profile * (1 - s.ribDepth * groove(s, theta));
    return [Math.cos(theta) * rad, y, -Math.sin(theta) * rad];
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

    // MEASURE IN A SQUARE SPACE. u wraps the whole circumference while v spans only the height, so
    // a circle of radius r in UV is an ellipse on the fruit — three and a half times wider across
    // than it is tall. Stretching u by the stroke's stored aspect makes a plain circular test here
    // come out ROUND on the pumpkin, exactly as PumpkinCarveQuery does it. Strokes saved before
    // aspect existed carry 0 and take the old isotropic path, so old pumpkins are untouched.
    const k = st.aspect > 0.001 ? st.aspect : 1;
    pu *= k;

    for (let i = 0; i + 1 < n; i++) {
      const ax = (uu[i] + wrap) * k, ay = st.v[i];
      const bx = (uu[i + 1] + wrap) * k, by = st.v[i + 1];
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
  function strokeHits(e, pu, pv) {
    const st = e.st, uu = e.uu;
    const r = st.closed ? 0 : (st.width || 0.02) * 0.5;

    // v does not wrap, so one test covers all three passes. Outside the box is
    // outside the shape for a filled polygon too: a point left of the whole
    // outline has its +x ray crossing an even number of times.
    if (pv < e.minV - r || pv > e.maxV + r) return false;

    for (let wrap = -1; wrap <= 1; wrap++) {
      const x = pu - wrap;
      if (x < e.minU - r || x > e.maxU + r) continue;
      if (st.closed) { if (insidePolygon(st, uu, wrap, pu, pv)) return true; }
      else if (nearPolyline(st, uu, wrap, pu, pv, r)) return true;
    }
    return false;
  }

  function prepStrokes(carve) {
    const out = (carve.strokes || [])
      .filter((st) => st && st.u && st.v && Math.min(st.u.length, st.v.length) >= 2)
      .map((st) => {
        // A BOX TO REJECT AGAINST. Without it every "is this point cut" query
        // walked all seventy-odd segments of every stroke just to conclude it was
        // nowhere near — and that query runs for four corners of every cell. It
        // is what made a finer grid unaffordable here.
        const uu = unwrapU(st);
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        for (let i = 0; i < uu.length; i++) {
          if (uu[i] < minU) minU = uu[i];
          if (uu[i] > maxU) maxU = uu[i];
          if (st.v[i] < minV) minV = st.v[i];
          if (st.v[i] > maxV) maxV = st.v[i];
        }
        return { st, uu, minU, maxU, minV, maxV };
      });
    out.tape = hasTape(out);      // decided once, not per sampled point
    return out;
  }

  // ── TOOL 2 IS PATCH TAPE, AND IT PUTS THE SKIN BACK ───────────────────────
  //
  // Ignoring it was not a cosmetic bug: a design made by cutting a big opening and taping most of it
  // back rendered here as the raw opening, so a carefully built face came out as a pumpkin with its
  // whole front missing. Measured on a real save: 9 tape strokes against 2 knife strokes.
  //
  // Tape means strokes have to be read IN ORDER — "cut then taped" and "taped then cut" are
  // different answers — so the early-out only survives for carves that contain no tape, which is
  // every pumpkin saved before it existed.
  const KNIFE = 0, SCRAPER = 1, TAPE = 2;

  function hasTape(prepped) {
    for (const { st } of prepped) if (st.tool === TAPE) return true;
    return false;
  }

  function isCut(prepped, pu, pv) {
    if (!prepped.tape) {
      for (const e of prepped)
        if (e.st.tool === KNIFE && strokeHits(e, pu, pv)) return true;
      return false;
    }
    let cut = false;
    for (const e of prepped) {
      if (e.st.tool === KNIFE) { if (!cut && strokeHits(e, pu, pv)) cut = true; }
      else if (e.st.tool === TAPE) { if (cut && strokeHits(e, pu, pv)) cut = false; }
    }
    return cut;
  }

  function scrapeDepth(prepped, pu, pv) {
    let best = 0;
    for (const e of prepped) {
      const st = e.st;
      if (st.tool === SCRAPER) {
        if (strokeHits(e, pu, pv))
          best = Math.max(best, Math.min(1, Math.max(0, st.depth == null ? 0.6 : st.depth)));
      } else if (st.tool === TAPE && best > 0 && strokeHits(e, pu, pv)) {
        // Deepest still wins BETWEEN scrapes — tape only resets what came before it, so two
        // overlapping scrapes of different depths keep taking the deeper, as they always have.
        best = 0;
      }
    }
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
  // Exactly the numbers PumpkinGenerator.BodyColor has. They are NOT linear: the game writes them as
  // raw bytes into an sRGB texture (or a material Color, which Unity treats as sRGB too), so what
  // the shader lights is these numbers DECODED. Treating them as linear here re-encoded them on the
  // way into the canvas, and classic orange (0.86, 0.38, 0.09) turned into pale peach. See
  // gameAlbedo below for the whole route.
  const BODY_COLORS = [
    [0.86, 0.38, 0.09], [0.78, 0.31, 0.07], [0.91, 0.47, 0.14],
    [0.83, 0.44, 0.13], [0.90, 0.60, 0.20], [0.92, 0.72, 0.30],
    [0.89, 0.80, 0.55], [0.92, 0.88, 0.76], [0.85, 0.82, 0.70],
    [0.63, 0.66, 0.42], [0.44, 0.50, 0.28], [0.55, 0.28, 0.13],
  ];
  function bodyColor(carve) {
    const i = carve && carve.shape ? (carve.shape.colorIndex | 0) : 0;
    return BODY_COLORS[((i % BODY_COLORS.length) + BODY_COLORS.length) % BODY_COLORS.length];
  }
  // ── WHAT THE GAME ACTUALLY LIGHTS: ALBEDO, MEASURED IN THE EDITOR ──────────────────────────
  //
  // Every colour on a Bark pumpkin reaches the shader through a texture that darkens or tints it,
  // and the site used to skip all of them. Measured from the real assets (average, linear):
  //
  //   PumpkinSkin_Albedo   (0.783, 0.757, 0.705)   the rind; also the stem's base map
  //   PumpkinFlesh_Albedo  (0.681, 0.635, 0.537)   the cut walls and the cavity
  //
  // A CARVED pumpkin is drawn with its own baked texture times PumpkinSkin_Albedo times TWO
  // (URP's _DETAIL_MULX2). The game halves the rind colour before baking so the rind comes out the
  // same as an uncarved one, but NOT the flesh of a scrape - so a scrape is about twice as bright
  // as the skin around it, which is exactly why it reads in the game and did not here.
  const SKIN_MAP  = [0.783, 0.757, 0.705];
  const FLESH_MAP = [0.681, 0.635, 0.537];
  const BAKE_COMPENSATION = Math.pow(0.5, 1 / 2.2);   // CarvablePumpkin.DetailMulX2Compensation

  // ── HEADROOM, NOT CLIPPING ──────────────────────────────────────────────────
  //
  // That doubled scrape flesh is brighter than 1.0 (about 1.5 on the red), which a canvas cannot
  // hold. So every albedo on the site is stored at HEADROOM of its real value and every light is
  // 1 / HEADROOM as bright. Lighting is linear, so that is the same picture with nothing clipped.
  const HEADROOM = 0.65;
  const LIGHT_GAIN = 1 / HEADROOM;

  function toLinear(c) {
    c = Math.min(1, Math.max(0, c));
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  // A material colour as the game lights it: decoded, times its texture's average, into headroom.
  const gameAlbedo = (srgb, map) => [0, 1, 2].map((k) => toLinear(srgb[k]) * map[k] * HEADROOM);

  const FLESH_COLOR = [0.93, 0.82, 0.55];     // PumpkinFlesh's _BaseColor (sRGB, like every Color)
  const FLESH = gameAlbedo(FLESH_COLOR, FLESH_MAP);   // vertex colours are linear: pre-lit albedo
  const SCRAPE_FLESH = [0.97, 0.88, 0.52];    // PumpkinCarveSkin.FleshColor, baked as bytes

  // ── THE SKIN TEXTURE ───────────────────────────────────────────────────────
  //
  // Ported from PumpkinCarveSkin, not approximated: the same value noise, the
  // same two octaves at the same frequencies, the same "paler patches drift
  // yellow" tweak. A flat vertex colour is why the gallery pumpkins looked like
  // plastic next to the game's.
  //
  // The SCRAPE is baked in here too, exactly as the game does it. A scrape is a
  // colour change, and resolving it in the texture rather than the mesh is what
  // makes a shaved letter come out with a clean edge instead of a staircase.

  function hash2(x, y) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
    h = Math.imul(h ^ (h >> 13), 1274126177) | 0;
    return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff;
  }
  const wrapI = (v, p) => ((v % p) + p) % p;

  function valueNoise(x, y, period) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    const n00 = hash2(wrapI(xi, period), wrapI(yi, period));
    const n10 = hash2(wrapI(xi + 1, period), wrapI(yi, period));
    const n01 = hash2(wrapI(xi, period), wrapI(yi + 1, period));
    const n11 = hash2(wrapI(xi + 1, period), wrapI(yi + 1, period));
    const a = n00 + (n10 - n00) * sx, b = n01 + (n11 - n01) * sx;
    return a + (b - a) * sy;
  }

  function fbm(u, v, freq, octaves) {
    let sum = 0, amp = 1, norm = 0, p = Math.max(1, Math.round(freq));
    for (let o = 0; o < octaves; o++) {
      sum += valueNoise(u * p, v * p, p) * amp;
      norm += amp; amp *= 0.5; p *= 2;
    }
    return (sum / Math.max(1e-4, norm)) * 2 - 1;
  }

  function toSRGB(x) {
    x = Math.min(1, Math.max(0, x));
    return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  }

  // ── GAME BYTE -> SITE BYTE, ONE TABLE PER CHANNEL ──────────────────────────
  //
  // The skin below is baked into BYTES exactly as PumpkinCarveSkin bakes it. What the game's shader
  // then does to a byte is fixed - decode it, times the skin map, times two - so it is done once per
  // possible byte here instead of with two Math.pow calls per texel. The result is re-encoded for
  // the canvas (it is an sRGB texture; three decodes it back before lighting).
  const BYTE_TO_SITE = [0, 1, 2].map((k) => {
    const t = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++)
      t[i] = Math.round(toSRGB(toLinear(i / 255) * 2 * SKIN_MAP[k] * HEADROOM) * 255);
    return t;
  });
  const toByte = (x) => Math.round(Math.min(1, Math.max(0, x)) * 255);   // Unity's Color -> Color32

  // The game's size. At 256 a scrape's darker rim was half a texel and simply vanished.
  const SKIN_TEX = 512;

  // ── THE MOTTLE IS CACHED, NOT RECOMPUTED PER PUMPKIN ───────────────────────
  //
  // Same trick PumpkinCarveSkin uses, and for the same reason: the field is low
  // frequency and depends only on the pumpkin's ASPECT, so it is generated once
  // at a quarter resolution and shared by every fruit with that shape ratio.
  //
  // Computing it per texel per pumpkin was 25 x 65k texels x four noise lookups —
  // several seconds of blocked main thread, which is why the gallery sat empty
  // even though nothing had thrown.
  const MOTTLE = 256;
  const mottleCache = new Map();

  function mottleField(aspect) {
    let f = mottleCache.get(aspect);
    if (f) return f;
    f = new Float32Array(MOTTLE * MOTTLE);
    for (let y = 0; y < MOTTLE; y++) {
      const v = (y + 0.5) / MOTTLE;
      for (let x = 0; x < MOTTLE; x++) {
        const u = (x + 0.5) / MOTTLE;
        f[y * MOTTLE + x] = fbm(u * aspect, v, 3, 2) * 0.045 + fbm(u * aspect, v, 24, 2) * 0.022;
      }
    }
    mottleCache.set(aspect, f);
    return f;
  }

  // ── THE CARVE MASK, AS PumpkinCarveMask.Rasterise WRITES IT ────────────────
  //
  // One byte per texel, in stroke order: a knife writes 255, a scrape its depth x 254, patch tape
  // puts it back to 0. KNIFE CUTS ARE IN IT TOO, and that matters: the blur below carries a hole a
  // texel out onto the skin, which is what gives every cut in the game its thin pale lip and dark
  // line.
  //
  // RASTERISED, NOT QUERIED. Asking "is this texel in a stroke?" for every texel near one cost up
  // to 125ms on a busy pumpkin; stamping each stroke into the mask, the way the game does it, costs
  // only the area actually carved.
  function carveMask(prepped) {
    const N = SKIN_TEX;
    const px = new Uint8Array(N * N);
    let any = false;
    for (const e of prepped) {
      const st = e.st, tool = st.tool;
      if (tool !== KNIFE && tool !== SCRAPER && tool !== TAPE) continue;
      const erase = tool === TAPE;
      const depth = Math.min(1, Math.max(0, st.depth == null ? 0.6 : st.depth));
      const value = tool === KNIFE ? 255 : erase ? 0 : Math.min(254, Math.max(1, Math.round(depth * 254)));

      const ry = st.closed ? 0 : Math.max(0.5 / N, (st.width || 0.02) * 0.5);
      const rx = st.closed ? 0 : Math.max(0.5 / N, ry / (st.aspect > 0.001 ? st.aspect : 1));
      // THREE PASSES FOR THE SEAM, as the game: u = 0 and u = 1 are the same line on the fruit.
      for (let wrap = -1; wrap <= 1; wrap++) {
        if (e.maxU + wrap + rx < 0 || e.minU + wrap - rx > 1) continue;   // nowhere on this pass
        if (st.closed) fillPolygon(px, N, st, e.uu, wrap, value, erase);
        else stampPolyline(px, N, st, e.uu, wrap, rx, ry, value, erase);
      }
      if (!erase) any = true;
    }
    if (!any) return null;

    // Which rows hold anything: everything outside is untouched skin (the game's FindBounds).
    let y0 = N, y1 = -1;
    for (let y = 0; y < N; y++) {
      const row = y * N;
      for (let x = 0; x < N; x++) if (px[row + x]) { if (y < y0) y0 = y; y1 = y; break; }
    }
    return y1 < 0 ? null : { px, y0, y1 };
  }

  // Deepest wins; tape forces it back to bare skin. (PumpkinCarveMask.Write)
  function writeMask(px, i, value, erase) {
    if (erase) px[i] = 0;
    else if (value > px[i]) px[i] = value;
  }

  // Scanline even-odd fill, so the inside of an O stays skin. (PumpkinCarveMask.FillPolygon)
  function fillPolygon(px, N, st, uu, wrap, value, erase) {
    const n = Math.min(st.u.length, st.v.length, uu.length);
    let minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < n; i++) { if (st.v[i] < minV) minV = st.v[i]; if (st.v[i] > maxV) maxV = st.v[i]; }
    const ya = Math.max(0, Math.floor(minV * N)), yb = Math.min(N - 1, Math.ceil(maxV * N));
    const xs = [];
    for (let y = ya; y <= yb; y++) {
      const py = (y + 0.5) / N;
      xs.length = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const v0 = st.v[i], v1 = st.v[j];
        if ((v0 <= py && v1 > py) || (v1 <= py && v0 > py))
          xs.push(uu[i] + wrap + ((py - v0) / (v1 - v0)) * (uu[j] - uu[i]));
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.floor(xs[k] * N)), xb = Math.min(N - 1, Math.ceil(xs[k + 1] * N));
        for (let x = xa; x <= xb; x++) writeMask(px, y * N + x, value, erase);
      }
    }
  }

  // An ellipse in UV (a circle on the fruit) stamped every half texel along the line, so the
  // stamps overlap into a solid stroke. (PumpkinCarveMask.StampPolyline + Disc)
  function stampPolyline(px, N, st, uu, wrap, rx, ry, value, erase) {
    const n = Math.min(st.u.length, st.v.length, uu.length);
    for (let i = 0; i + 1 < n; i++) {
      const ax = uu[i] + wrap, ay = st.v[i], bx = uu[i + 1] + wrap, by = st.v[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * N * 2));
      for (let j = 0; j <= steps; j++) {
        const t = j / steps, cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t;
        const xa = Math.max(0, Math.floor((cx - rx) * N)), xb = Math.min(N - 1, Math.ceil((cx + rx) * N));
        if (xa > xb) continue;
        const ya = Math.max(0, Math.floor((cy - ry) * N)), yb = Math.min(N - 1, Math.ceil((cy + ry) * N));
        for (let y = ya; y <= yb; y++) {
          const dy = ((y + 0.5) / N - cy) / ry, dy2 = dy * dy;
          if (dy2 > 1) continue;
          for (let x = xa; x <= xb; x++) {
            const dx = ((x + 0.5) / N - cx) / rx;
            if (dx * dx + dy2 <= 1) writeMask(px, y * N + x, value, erase);
          }
        }
      }
    }
  }

  // 3x3 average, as PumpkinCarveSkin.Blur3: u WRAPS (or the back of every pumpkin gets a hard
  // line up the seam), v clamps.
  function blur3(mask, x, y) {
    const N = SKIN_TEX, px = mask.px;
    const xm = (x - 1 + N) % N, xp = (x + 1) % N;
    const ym = Math.max(0, y - 1) * N, yc = y * N, yp = Math.min(N - 1, y + 1) * N;
    return (px[ym + xm] + px[ym + x] + px[ym + xp] +
            px[yc + xm] + px[yc + x] + px[yc + xp] +
            px[yp + xm] + px[yp + x] + px[yp + xp]) / 9;
  }

  function makeSkinTexture(carve, prepped) {
    const s = carve.shape;
    const cv = document.createElement('canvas');
    cv.width = cv.height = SKIN_TEX;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(SKIN_TEX, SKIN_TEX);
    const d = img.data;

    // Baked exactly as PumpkinCarveSkin bakes it - the rind halved first (the carved material
    // doubles it back), everything in BYTES - then turned into what the game's shader would light.
    const SKIN = bodyColor(carve);
    const BAKE = SKIN.map((c) => c * BAKE_COMPENSATION);
    const [R8, G8, B8] = BYTE_TO_SITE;

    // The mottle repeats around u, so the lattice period has to be a whole
    // number or the noise does not meet itself at the seam.
    const circumference = Math.PI * Math.max(0.01, s.width);
    const aspect = Math.min(8, Math.max(1, Math.round(circumference / Math.max(0.01, s.height))));

    const N = SKIN_TEX;
    const mask = carveMask(prepped);     // null when nothing touches the skin
    const mottle = mottleField(aspect);

    // WHAT GLOWS WHEN A CANDLE IS LIT: thin skin, by how thin (PumpkinCarveSkin's emission map).
    // Only a pumpkin with marks gets one. Opaque black to start: a canvas keeps colour
    // premultiplied, so a transparent texel would lose its value on the way to the GPU.
    let glowCv = null, glowImg = null, glowD = null;
    if (mask) {
      glowCv = document.createElement('canvas');
      glowCv.width = glowCv.height = N;
      glowImg = glowCv.getContext('2d').createImageData(N, N);
      glowD = glowImg.data;
      new Uint32Array(glowD.buffer).fill(0xff000000);
    }

    for (let y = 0; y < N; y++) {
      const v = (y + 0.5) / N;
      const marked = mask !== null && y >= mask.y0 - 1 && y <= mask.y1 + 1;
      const mrow = (((y * MOTTLE) / N) | 0) * MOTTLE;
      for (let x = 0; x < N; x++) {
        const m = mottle[mrow + (((x * MOTTLE) / N) | 0)];

        let r = toByte(BAKE[0] * (1 + m));
        let g = toByte(BAKE[1] * (1 + m) * (1 + m * 0.45));   // paler patches drift yellow
        let b = toByte(BAKE[2] * (1 + m));

        if (marked) {
          // PumpkinCarveSkin.Composite, line for line.
          const scrape = Math.min(1, blur3(mask, x, y) / 254);
          if (scrape > 0.001) {
            const t = smoothstep01((scrape - 0.04) / 0.18);
            if (t > 0.001) {
              const u = (x + 0.5) / N;
              const grain = 0.92 + fbm(u * aspect * 4, v * 1.6, 9, 2) * 0.10;
              // A DARKER LINE AT THE EDGE - the skin is cut through at the rim of a scrape, and
              // without it the marks read as painted on rather than gouged in.
              const edge = Math.min(1, Math.max(0, 1 - Math.abs(scrape - 0.13) / 0.11));
              const dark = 1 - edge * 0.34;
              r = toByte((r / 255 + (SCRAPE_FLESH[0] * grain - r / 255) * t) * dark);
              g = toByte((g / 255 + (SCRAPE_FLESH[1] * grain - g / 255) * t) * dark);
              b = toByte((b / 255 + (SCRAPE_FLESH[2] * grain - b / 255) * t) * dark);

              const glow = toByte(smoothstep01((scrape - 0.15) / 0.8));
              const gi = (y * N + x) * 4;
              glowD[gi] = glowD[gi + 1] = glowD[gi + 2] = glow;
            }
          }
        }

        const i = (y * N + x) * 4;
        d[i]     = R8[r];
        d[i + 1] = G8[g];
        d[i + 2] = B8[b];
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (glowCv) glowCv.getContext('2d').putImageData(glowImg, 0, 0);

    return {
      map: skinCanvasTexture(cv, true),
      glow: glowCv ? skinCanvasTexture(glowCv, false) : null,   // linear, like the game's
    };
  }

  function skinCanvasTexture(cv, srgb) {
    const tex = new THREE.CanvasTexture(cv);
    // ── NOT FLIPPED, OR EVERY SCRAPE COMES OUT UPSIDE DOWN ────────────────────
    //
    // Row y of the canvas above is written as v = y / SKIN_TEX, so row 0 is the BOTTOM of the
    // pumpkin. three.js flips a canvas on upload by default (image top -> v = 1), which put row 0
    // at the TOP: a scraped smile came out as a frown above the mouth, while its recess - which is
    // geometry, not texture - stayed where it was carved.
    tex.flipY = false;
    tex.wrapS = THREE.RepeatWrapping;    // u goes around
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 4;
    if (srgb && THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
    tex.needsUpdate = true;
    return tex;
  }

  // ── THE STEM ───────────────────────────────────────────────────────────────
  //
  // The site had NONE. What looked like "bugged stems" was the bare crown of the
  // body mesh with nothing sitting on it. Ported from PumpkinGenerator.BuildStem,
  // including the seating: the base starts BELOW the top and is swallowed by the
  // shoulder, or every pumpkin gets a stem hovering over a hole.
  // PumpkinGenerator.StemColor, lit as the game lights it (the stem wears PumpkinSkin_Albedo too).
  // Used raw, as linear vertex colours, they came out pale beige instead of brown.
  const STEM_COLORS = [[0.60, 0.50, 0.32], [0.55, 0.46, 0.28], [0.64, 0.55, 0.36]]
    .map((c) => gameAlbedo(c, SKIN_MAP));

  function buildStem(s, colorIndex, push) {
    const rings = 14;
    const sides = Math.max(4, Math.round(s.stemSides || 6));
    const col = STEM_COLORS[((colorIndex % 3) + 3) % 3];

    const bendRad = (s.stemCurveDirection || 0) * Math.PI / 180;
    const bendDir = [Math.cos(bendRad), 0, -Math.sin(bendRad)];   // -sin: same mirror as the body
    const thick = s.stemThickness || 0.02;
    const baseY = s.height * 0.5 - (s.topDimple || 0) * s.height * 1.25 - thick * 0.6;
    const sunk  = (s.topDimple || 0) * s.height * 0.25 + thick * 0.6;
    const len   = s.stemLength || 0.06;
    const curve = s.stemCurve || 0;

    const ringAt = (t) => {
      const flare = (s.stemFlare || 1) + (1 - (s.stemFlare || 1)) * smoothstep01(Math.min(1, t * 3));
      const rad = thick * flare * (1 + ((s.stemTaper || 0.6) - 1) * t * t);
      const cy = baseY + (len + sunk) * t;
      const out = [];
      for (let c = 0; c <= sides; c++) {
        const theta = (c / sides) * Math.PI * 2;
        const ridge = 1 + 0.12 * Math.cos(theta * sides);
        out.push([Math.cos(theta) * rad * ridge + bendDir[0] * curve * t * t,
                  cy,
                  -Math.sin(theta) * rad * ridge + bendDir[2] * curve * t * t]);
      }
      return out;
    };

    let prev = ringAt(0);
    for (let r = 1; r <= rings; r++) {
      const cur = ringAt(r / rings);
      for (let c = 0; c < sides; c++) {
        const a = prev[c], b = prev[c + 1], dd = cur[c], e = cur[c + 1];
        for (const tri of [[a, dd, b], [b, dd, e]]) {
          const n = triNormal(tri[0], tri[1], tri[2], [0, baseY, 0]);
          for (const q of tri) push(q, n, col);
        }
      }
      prev = cur;
    }
    // Cap the tip, or you can see down the inside of the stem.
    const tip = [bendDir[0] * curve, baseY + len + sunk, bendDir[2] * curve];
    for (let c = 0; c < sides; c++) {
      const tri = [prev[c], tip, prev[c + 1]];
      const n = triNormal(tri[0], tri[1], tri[2], [0, baseY, 0]);
      for (const q of tri) push(q, n, col);
    }
  }

  // Face normal, forced to point away from a reference point inside the solid.
  function triNormal(a, b, c, inside) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = norm3([e1[1] * e2[2] - e1[2] * e2[1],
                   e1[2] * e2[0] - e1[0] * e2[2],
                   e1[0] * e2[1] - e1[1] * e2[0]]);
    const away = [a[0] - inside[0], a[1] - inside[1], a[2] - inside[2]];
    if (n[0] * away[0] + n[1] * away[1] + n[2] * away[2] < 0) n = [-n[0], -n[1], -n[2]];
    return n;
  }

  function buildPumpkin(carve) {
    const s = carve.shape;
    const prepped = prepStrokes(carve);
    const anyCut = prepped.some((p) => p.st.tool === 0);

    // MUCH FINER THAN THE GAME'S, on purpose. In VR this grid is rebuilt every
    // time you cut and has to fit in a frame; here it is built ONCE per card on a
    // desktop GPU and then only spun. The game buys detail back with adaptive
    // subdivision around the cuts; the cheaper way to match it off-line is simply
    // to afford a finer grid everywhere.
    const rings = 80, segs = Math.max(132, Math.round(s.lobes * 14));
    const wall = Math.min(0.09, Math.max(0.012, s.height * 0.11));

    // TWO STREAMS, because the skin and the flesh are shaded differently: the skin
    // wears the baked texture, the cut walls and cavity and stem are flat colour.
    // Same split the game makes with its two submeshes, and for the same reason —
    // one material cannot be both a mottled rind and a wet inner wall.
    const sPos = [], sNor = [], sUv = [];
    const fPos = [], fNor = [], fCol = [];

    const pushSkin  = (p, n, uv) => {
      sPos.push(p[0], p[1], p[2]); sNor.push(n[0], n[1], n[2]); sUv.push(uv[0], uv[1]);
    };
    const push = (p, n, c) => {      // flesh + stem
      fPos.push(p[0], p[1], p[2]); fNor.push(n[0], n[1], n[2]); fCol.push(c[0], c[1], c[2]);
    };

    const skinAt = (u, v) => {
      const d = scrapeDepth(prepped, u, v);
      const n = surfaceNormal(s, u, v);
      const p = surfacePoint(s, u, v);
        // Same rule the game uses: a fraction of the wall, capped in METRES so a big
      // pumpkin does not get a crater and a small one is not hollowed out.
      // See PumpkinCarveMesh.ScrapeRecess.
      const inset = Math.min(d * 0.45 * wall, 0.012);
      // The scrape's COLOUR lives in the baked texture now (crisper than any mesh
      // could resolve it); what stays here is the recess, which is geometry.
      return { p: [p[0] - n[0] * inset, p[1] - n[1] * inset, p[2] - n[2] * inset], n, uv: [u, v] };
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
          pushSkin(vs[0].p, vs[0].n, vs[0].uv);
          pushSkin(vs[i + 1].p, vs[i + 1].n, vs[i + 1].uv);
          pushSkin(vs[i].p, vs[i].n, vs[i].uv);
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

    const stemStart = fPos.length / 3;   // the stem gets its own group: a candle lights the
    buildStem(s, (s.colorIndex | 0), push);   // flesh, and a glowing stem looked plugged in

    // Concatenated skin-first, so the two groups are contiguous ranges. Every
    // vertex carries both a uv and a colour; each material only reads the one it
    // cares about, which is cheaper than two geometries and keeps it one draw
    // call per material.
    // ── THE MIRROR FLIPPED THE WINDING, SO FLIP IT BACK ──────────────────────
    //
    // Negating Z to convert Unity's handedness mirrors the surface, and a mirrored
    // triangle is wound the other way round. Every face that should be front is
    // now back — which is invisible under DoubleSide right up until you put a
    // light INSIDE the pumpkin: three flips the shading normal on back faces, so
    // the rind's normal ended up pointing inward and the candle lit the OUTSIDE
    // of the fruit. Lighting one up made the whole thing glow like a paper lamp
    // instead of showing a face.
    //
    // Swapping the 2nd and 3rd vertex of every triangle restores the winding
    // without touching positions or normals.
    const flipWinding = (arr, stride) => {
      for (let i = 0; i + 3 * stride <= arr.length; i += 3 * stride)
        for (let k = 0; k < stride; k++) {
          const a = i + stride + k, b = i + 2 * stride + k;
          const t = arr[a]; arr[a] = arr[b]; arr[b] = t;
        }
    };
    for (const [arr, stride] of [[sPos, 3], [sNor, 3], [sUv, 2],
                                 [fPos, 3], [fNor, 3], [fCol, 3]]) flipWinding(arr, stride);

    const skinCount = sPos.length / 3, fleshCount = fPos.length / 3;
    const pos = sPos.concat(fPos);
    const nor = sNor.concat(fNor);
    const uv  = sUv.concat(new Array(fleshCount * 2).fill(0));
    const col = new Array(skinCount * 3).fill(1).concat(fCol);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.addGroup(0, skinCount, 0);                 // skin  -> textured material
    g.addGroup(skinCount, stemStart, 1);         // flesh -> vertex colours, glows when lit
    g.addGroup(skinCount + stemStart, fleshCount - stemStart, 2);   // stem -> vertex colours
    g.computeBoundingSphere();
    return g;
  }

  // ── Cards ────────────────────────────────────────────────────────────────

  const viewers = [];

  // ── ONE RENDERER FOR THE WHOLE GALLERY ───────────────────────────────────
  //
  // THIS IS WHY THE GALLERY WENT BLANK. Every card used to build its own
  // THREE.WebGLRenderer, and a browser only keeps 8-16 WebGL contexts alive at
  // once — past that it silently kills the OLDEST to make room. So the gallery
  // worked fine until there were more pumpkins than contexts, and from then on
  // every card that scrolled in murdered an older one. The console said it
  // outright, eighteen times: "Too many active WebGL contexts. Oldest context
  // will be lost." The dead ones render nothing, which is the white tiles.
  //
  // It is not a bug that gets better on its own either — it gets worse with
  // every pumpkin anybody saves.
  //
  // So: ONE renderer, off-screen, reused. Each card keeps a plain 2D canvas and
  // the shared renderer's output is blitted into it. One context, any number of
  // pumpkins. This is the arrangement three.js's own multiple-element example
  // uses, for exactly this reason.
  let shared = null;
  function sharedRenderer() {
    if (!shared) {
      shared = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      shared.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      // WITHOUT THIS EVERYTHING IS WASHED OUT. This three.js predates automatic
      // colour management, and its default outputEncoding is LINEAR — the shader
      // writes linear light straight to a framebuffer the browser then shows as
      // sRGB, so every colour comes out far too bright. Lighting still happens in
      // linear; only the final write is converted.
      if (THREE.sRGBEncoding !== undefined) shared.outputEncoding = THREE.sRGBEncoding;
    }
    return shared;
  }

  function makeViewer(canvas, carve) {
    const ctx2d = canvas.getContext('2d');

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 50);

    const geo = buildPumpkin(carve);
    const skin = makeSkinTexture(carve, prepStrokes(carve));
    // Nearly matte, as the game has them (smoothness 0.06 rind, 0.05 flesh). At 0.78 a broad
    // white sheen sat over the top of every fruit and paled it further.
    // The emissive is the game's GlowColor (linear) through the scrape glow map, off until lit.
    const skinMat = new THREE.MeshStandardMaterial({
      map: skin.map, roughness: 0.93, metalness: 0.0, side: THREE.DoubleSide,
      emissive: new THREE.Color(1.0, 0.063, 0.0048), emissiveMap: skin.glow, emissiveIntensity: 0.0 });
    const fleshMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
      // The inside is what a candle lights, so it is the part that glows. Driven
      // by setLit below rather than baked in, so an unlit pumpkin looks unlit.
      emissive: new THREE.Color(0xff6a1a), emissiveIntensity: 0.0 });
    const stemMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0.0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, [skinMat, fleshMat, stemMat]);
    scene.add(mesh);

    // ── DAYLIGHT, NOT A PHOTO STUDIO ─────────────────────────────────────────
    //
    // This was ambient 0.42 + key 1.45: a face turned to the key got 1.9x its own colour, and with
    // no tone mapping everything past 1.0 simply clips - orange went peach, cream went white. Now
    // the front of a pumpkin gets about its own colour and only the brightest shoulder a little
    // more, which is how it looks in the game in daylight. (x LIGHT_GAIN: see HEADROOM.)
    const AMB = 0.5 * LIGHT_GAIN, KEY = 0.8 * LIGHT_GAIN, RIM = 0.2 * LIGHT_GAIN;
    const amb = new THREE.AmbientLight(0xfff2e4, AMB);   // warm, so it cannot grey the rind
    scene.add(amb);
    const key = new THREE.DirectionalLight(0xfff4e6, KEY);
    key.position.set(2, 3, 2.5);
    scene.add(key);

    // ── A NEUTRAL FILL, NOT A BLUE ONE ───────────────────────────────────────
    //
    // This was 0x88aaff at 0.35, which is a lovely studio rim on a grey model and
    // poison on a pumpkin. Measured against the palette: the pale gourds came back
    // a uniform 0.62-0.66 of their albedo (just lit, fine), but classic orange —
    // (0.86, 0.38, 0.09), almost no blue in it — rendered with 2.76x too much
    // blue. A blue fill on a surface with nothing to reflect it lands entirely as
    // desaturation, so the most orange pumpkins came out the palest.
    const rim = new THREE.DirectionalLight(0xffe9d2, RIM);
    rim.position.set(-2, 1, -2);
    scene.add(rim);

    // ── THE CANDLE ───────────────────────────────────────────────────────────
    //
    // A real point light INSIDE the fruit rather than a flat emissive tint, for
    // the same reason the game wants one: what sells a jack-o-lantern is the
    // falloff across the cut walls and the light spilling out of the holes. A
    // uniform glow just makes the whole thing pale.
    //
    // Sat low, where a candle actually stands, so the light comes up through the
    // face. Off until asked for; toggling only changes intensities, so nothing
    // is rebuilt and no context work happens.
    const candle = new THREE.PointLight(0xffb347, 0.0, 0, 2);
    candle.position.set(0, -(carve.shape.height || 0.3) * 0.18, 0);
    scene.add(candle);

    const radius = geo.boundingSphere ? geo.boundingSphere.radius : 0.4;
    cam.position.set(0, radius * 0.25, radius * 3.6);
    cam.lookAt(0, 0, 0);

    let spin = 0, dragging = false, lastX = 0, auto = true;
    canvas.addEventListener('pointerdown', (e) => { dragging = true; auto = false; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (dragging) { spin += (e.clientX - lastX) * 0.01; lastX = e.clientX; } });
    canvas.addEventListener('pointerup',   (e) => { dragging = false; try { canvas.releasePointerCapture(e.pointerId); } catch (_) {} });

    return {
      canvas,
      visible: true,          // set by the observer below
      // A paged gallery throws cards away every page turn. The GPU-side geometry and the skin
      // texture outlive their canvas unless they are released here.
      dispose() {
        geo.dispose(); skin.map.dispose(); if (skin.glow) skin.glow.dispose();
        skinMat.dispose(); fleshMat.dispose(); stemMat.dispose();
      },
      setLit(on) {
        // ── WHAT MAKES A LIT PUMPKIN READ ────────────────────────────────────
        //
        // Not "turn the lights down and put a lamp in it". A point light alone
        // barely touches the cut walls, because they face sideways into a hole,
        // so the first version just made everything dim and muddy.
        //
        // What actually sells it is the FLESH glowing — the walls and cavity are
        // the surfaces a candle lights, and they are what you see through the
        // cuts. So the inside emits, the rind keeps a little warm bounce so the
        // fruit does not go to silhouette, and the point light supplies falloff
        // on top of that rather than doing the whole job.
        // THE RIND MUST STAY DARK. Making it emissive too turned the whole fruit
        // into a lamp — you lose the carving entirely, because a face only reads
        // when the holes are brighter than what surrounds them. So only the
        // INSIDE emits, and the rind is left to a dim warm ambient plus whatever
        // the candle throws on it. Contrast is the effect; brightness is not.
        candle.intensity = on ? 2.2 * LIGHT_GAIN : 0.0;
        amb.intensity    = on ? 0.13 * LIGHT_GAIN : AMB;
        key.intensity    = on ? 0.20 * LIGHT_GAIN : KEY;
        rim.intensity    = on ? 0.05 * LIGHT_GAIN : RIM;
        fleshMat.emissiveIntensity = on ? 0.85 : 0.0;
        // Scraped skin is thin enough for the candle to show through, as in the game
        // (CarvablePumpkin.SkinGlow). No glow map = no marks = nothing to light.
        skinMat.emissiveIntensity = on && skin.glow ? 0.45 : 0.0;
      },
      tick(dt) {
        const w = canvas.clientWidth | 0, h = canvas.clientHeight | 0;
        if (w < 2 || h < 2) return;

        if (auto) spin += dt * 0.35;
        mesh.rotation.y = spin;

        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

        // Render into the SHARED context at this card's size, then copy the
        // pixels across. drawImage from a WebGL canvas is a GPU-side blit.
        const r = sharedRenderer();
        r.setSize(w, h, false);
        cam.aspect = w / Math.max(1, h);
        cam.updateProjectionMatrix();
        r.render(scene, cam);

        ctx2d.clearRect(0, 0, w, h);
        ctx2d.drawImage(r.domElement, 0, 0, w, h);
      },
    };
  }

  let last = performance.now();
  function animate() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // OFF-SCREEN CARDS ARE NOT DRAWN. Sixty spinning pumpkins is sixty draws a
    // frame for the ones you cannot see; with a single shared context they would
    // also all queue behind each other.
    for (const v of viewers) if (v.visible) v.tick(dt);
    requestAnimationFrame(animate);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Only the cards on screen get drawn. Falls back to drawing everything if the
  // browser has no IntersectionObserver, which is correct rather than blank.
  const cardObserver = typeof IntersectionObserver === 'undefined' ? null
    : new IntersectionObserver((entries) => {
        for (const e of entries) {
          const v = viewers.find((x) => x.canvas === e.target);
          if (v) v.visible = e.isIntersecting;
        }
      }, { rootMargin: '200px' });

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

    // Lights on / off. One button for the whole gallery — per-card switches would
    // be a lot of chrome for a thing you flip once to see the faces glow.
    let lit = false;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pump-lights';
    btn.textContent = 'Light them up';
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      lit = !lit;
      btn.textContent = lit ? 'Blow them out' : 'Light them up';
      btn.setAttribute('aria-pressed', lit ? 'true' : 'false');
      for (const v of viewers) v.setLit(lit);
    });
    status.insertAdjacentElement('afterend', btn);

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
        const v = makeViewer(card.querySelector('.pump-canvas'), carve);
        v.setLit(lit);           // cards stream in one at a time; match the switch
        viewers.push(v);
        if (cardObserver) { v.visible = false; cardObserver.observe(v.canvas); }
      } catch (e) {
        card.querySelector('.pump-meta').innerHTML += '<br><em>could not load</em>';
      }
    }

    animate();
  }

  // ── SHARED WITH THE MODERATION PAGE ─────────────────────────────────────────
  //
  // The viewer is the only honest way to judge a carve: a moderator needs to SEE
  // the pumpkin, and the website already rebuilds it from the same numbers the
  // game does. Exposing the builder is far better than a second renderer that
  // could drift out of step with this one.
  window.PumpkinViewer = makeViewer;

  // Only run the public gallery when the public gallery is actually on the page.
  // The moderation page loads this file purely for the viewer above.
  function boot() { if (document.getElementById('pumpkin-grid')) load(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
