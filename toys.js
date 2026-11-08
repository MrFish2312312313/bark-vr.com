// toys.js — bark-vr.com/creations, the TOYS tab: toys players made at the Workshop's toy benches in BARK - in 3D, and ALIVE.
//
// A toy comes from the Creations Server (backend-url.json's `creationsUrl`): its MODEL (one node per piece, "p<id>", twins
// "p<id>t<k>") and its DETAILS (every piece's group / colour / finish / hidden, the GROUPS, the STATES and the RULES - the code
// blocks it was given in the game). This file does here what the game's CreationPuppet + CreationItem do there:
//   STATES   a button for every state (AS BUILT first) - the toy changes to it
//   BLOCKS   clicking a piece = TOUCHED (rules on that piece / its group / the whole toy) + CLICKED; buttons for the holder's
//            events (A/X, GRAB, LET GO, SHAKE, THROW, LAND); EVERY n s and STARTED run by themselves; IN STATE chains
//   ACTIONS  show / hide / toggle / colour / next colour / finish / glow, go to / next state, spin / wobble / grow round the
//            target's middle, the game's own sounds (the same recipes, made in the browser), sparkles, a buzz on phones, waits
// Cards get a STILL from ONE shared renderer (like the pumpkins); PLAY opens a live player.
// window.Toys = { still(canvas, base, rec), open(base, rec), close() }. Needs three r128 + GLTFLoader + OrbitControls. 🍍

window.Toys = (() => {
  const T = window.THREE;
  const LOOKS = [                                   // the game's finishes (CreationMesher.Looks)
    { s: 0.62 }, { s: 0.12 }, { s: 0.93 }, { s: 0.72, m: 1 }, { s: 0.28 }, { s: 0.04 },
    { s: 0.18 }, { s: 0.38 }, { s: 0.95, glass: true }, { s: 0.5, glow: 1.6 }, { s: 0.72 },
  ];
  const TRIGGERS = ['TOUCHED', 'CLICKED', 'A / X PRESSED', 'GRABBED', 'LET GO', 'SHAKEN', 'THROWN', 'LANDED', 'EVERY', 'STARTED', 'IN STATE'];
  const VERBS = ['SHOW', 'HIDE', 'TOGGLE', 'COLOUR', 'NEXT COLOUR', 'FINISH', 'GO TO STATE', 'NEXT STATE', 'SPIN', 'WOBBLE', 'GROW', 'GLOW', 'SOUND', 'BUZZ', 'SPARKLES', 'WAIT'];
  const FINISHES = ['Plastic', 'Matte', 'Glossy', 'Metal', 'Wood', 'Plush', 'Clay', 'Rubber', 'Glass', 'Glow', 'Glitter'];
  const SOUNDS = ['SQUEAK', 'HONK', 'BELL', 'POP', 'BOING', 'CHIME', 'DRUM', 'WHISTLE', 'ZAP', 'BLIP'];
  const V = { Show: 0, Hide: 1, Toggle: 2, Colour: 3, NextColour: 4, Finish: 5, GoToState: 6, NextState: 7, Spin: 8, Wobble: 9, Grow: 10, Glow: 11, Sound: 12, Buzz: 13, Sparkles: 14, Wait: 15 };
  const TR = { Touched: 0, Clicked: 1, ButtonA: 2, Grabbed: 3, LetGo: 4, Shaken: 5, Thrown: 6, Landed: 7, Every: 8, Started: 9, EnteredState: 10 };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── LOADING (the model bytes + details, cached; a fresh scene is parsed per use) ─────────────────────────────

  const cache = new Map();
  function fetchToy(base, id) {
    if (!cache.has(id)) {
      cache.set(id, Promise.all([
        fetch(`${base}/api/creations/${encodeURIComponent(id)}`).then((r) => { if (!r.ok) throw new Error('details ' + r.status); return r.json(); }),
        fetch(`${base}/api/creations/${encodeURIComponent(id)}/model`).then((r) => { if (!r.ok) throw new Error('model ' + r.status); return r.arrayBuffer(); }),
      ]).catch((e) => { cache.delete(id); throw e; }));
    }
    return cache.get(id);
  }

  function parse(buffer) {
    return new Promise((resolve, reject) => new T.GLTFLoader().parse(buffer.slice(0), '', (g) => resolve(g.scene), reject));
  }

  // ── A TOY (looks, states, blocks) ─────────────────────────────────────────────────────────────────────────────

  class Toy {
    constructor(scene, details) {
      this.scene = scene;
      this.info = (details && details.info) || {};
      this.parts = new Map();                           // id -> { part, objs: [{ o, pos, quat, scale }] }
      for (const p of this.info.parts || []) this.parts.set(p.id, { part: p, objs: [] });
      const root = scene.getObjectByName('toy') || scene;
      this.root = root;
      root.traverse((o) => {
        const m = /^p(\d+)(?:t\d+)?$/.exec(o.name || '');
        if (!m) return;
        const id = +m[1];
        if (!this.parts.has(id)) this.parts.set(id, { part: { id, color: { r: 1, g: 1, b: 1 }, finish: 0, group: 0 }, objs: [] });
        const meshes = [];
        if (o.isMesh) meshes.push(o); else o.traverse((c) => { if (c.isMesh) meshes.push(c); });
        for (const mm of meshes) { mm.material = mm.material.clone(); mm.userData.part = id; }
        this.parts.get(id).objs.push({ o, meshes, pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.clone() });
      });
      this.groups = new Map((this.info.groups || []).map((g) => [g.id, g]));
      this.states = this.info.states || [];
      this.rules = this.info.rules || [];
      this.state = 0;
      this.changes = [];
      this.anims = [];
      this.onState = null;                              // the player redraws its buttons
      this.fired = new Map(); this.budgetT = 0; this.budget = 0;
      this.alive = true;
      this.apply();
    }

    covers(t, p) { return !t || t.kind === 0 || (t.kind === 1 && t.id === p.id) || (t.kind === 2 && t.id !== 0 && p.group === t.id); }
    same(a, b) { return a.kind === b.kind && (a.kind === 0 || a.id === b.id); }

    lookOf(p) {
      const g = this.groups.get(p.group);
      let shown = !p.hidden && !(g && g.hidden), color = p.color, finish = p.finish | 0;
      const st = this.states[this.state];
      if (this.state > 0 && st) {
        let gl = null, pl = null;
        for (const l of st.looks || []) {
          if (l.target.kind === 2 && p.group !== 0 && l.target.id === p.group) gl = l;
          else if (l.target.kind === 1 && l.target.id === p.id) pl = l;
          else if (l.target.kind === 0 && !gl) gl = l;
        }
        for (const l of [gl, pl]) {
          if (!l) continue;
          if (l.hidden >= 0) shown = l.hidden === 0;
          if (l.recolor) color = l.color;
          if (l.refinish) finish = l.finish | 0;
        }
      }
      let glow = 0;
      for (const pass of [0, 2, 1]) for (const ch of this.changes) {
        if (ch.target.kind !== pass || !this.covers(ch.target, p)) continue;
        if (ch.hidden >= 0) shown = ch.hidden === 0;
        if (ch.recolor) color = ch.color;
        if (ch.refinish) finish = ch.finish;
        if (ch.glow >= 0) glow = ch.glow;
      }
      return { shown, color, finish, glow };
    }

    apply() {
      for (const { part, objs } of this.parts.values()) {
        const l = this.lookOf(part);
        const look = LOOKS[l.finish] || LOOKS[0];
        for (const { o, meshes } of objs) {
          o.visible = l.shown;
          for (const m of meshes) {
            const mat = m.material;
            mat.color.setRGB(l.color.r, l.color.g, l.color.b).convertSRGBToLinear();
            mat.roughness = 1 - look.s; mat.metalness = look.m || 0;
            const g = Math.max(look.glow || 0, l.glow || 0);
            mat.emissive.copy(mat.color).multiplyScalar(Math.min(1, g));
            const glass = !!look.glass;
            if (mat.transparent !== glass) { mat.transparent = glass; mat.depthWrite = !glass; mat.needsUpdate = true; }
            mat.opacity = glass ? 0.35 : 1;
            mat.side = glass ? T.DoubleSide : T.FrontSide;
          }
        }
      }
    }

    setState(s) {
      const n = Math.max(1, this.states.length);
      const before = this.state;
      this.state = Math.max(0, Math.min(n - 1, s | 0));
      this.changes = [];
      this.apply();
      if (this.onState) this.onState();
      if (this.state !== before)
        this.rules.forEach((r, i) => { if (r.when === TR.EnteredState && Math.round(r.every) === this.state) this.run(i); });
    }

    change(t) {
      let c = this.changes.find((x) => this.same(x.target, t));
      if (!c) { c = { target: t, hidden: -1, recolor: false, refinish: false, glow: -1 }; this.changes.push(c); }
      return c;
    }

    pivot(t) {
      const box = new T.Box3(), tmp = new T.Box3();
      let any = false;
      this.root.updateMatrixWorld(true);
      const inv = new T.Matrix4().copy(this.root.matrixWorld).invert();
      for (const { part, objs } of this.parts.values()) {
        if (!this.covers(t, part)) continue;
        for (const { meshes } of objs) for (const m of meshes) {
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          tmp.copy(m.geometry.boundingBox).applyMatrix4(new T.Matrix4().multiplyMatrices(inv, m.matrixWorld));
          if (any) box.union(tmp); else { box.copy(tmp); any = true; }
        }
      }
      return any ? box.getCenter(new T.Vector3()) : new T.Vector3();
    }

    // ── THE BLOCKS ──

    fire(when, pieceId) {
      this.rules.forEach((r, i) => {
        if (r.when !== when) return;
        if (when === TR.Touched) { const pc = this.parts.get(pieceId); if (!pc || !this.covers(r.on, pc.part)) return; }
        this.run(i);
      });
    }

    async run(i) {
      const now = performance.now();
      if (now - (this.fired.get(i) || -1e9) < 250) return;
      if (now - this.budgetT > 1000) { this.budgetT = now; this.budget = 0; }
      if (++this.budget > 8) return;
      this.fired.set(i, now);
      const r = this.rules[i];
      for (const a of r.acts || []) {
        if (a.wait > 0) await sleep(a.wait * 1000);
        if (!this.alive) return;
        const t = a.target || { kind: 0, id: 0 };
        switch (a.verb) {
          case V.Show: this.change(t).hidden = 0; this.apply(); break;
          case V.Hide: this.change(t).hidden = 1; this.apply(); break;
          case V.Toggle: {
            let any = false;
            for (const { part, objs } of this.parts.values()) if (this.covers(t, part) && objs.some((x) => x.o.visible)) any = true;
            this.change(t).hidden = any ? 1 : 0; this.apply(); break;
          }
          case V.Colour: { const c = this.change(t); c.recolor = true; c.color = a.color; this.apply(); break; }
          case V.NextColour: {
            let col = { r: 1, g: 1, b: 1 };
            for (const { part } of this.parts.values()) if (this.covers(t, part)) { col = this.lookOf(part).color; break; }
            const hsl = {}; new T.Color(col.r, col.g, col.b).getHSL(hsl);
            const n = new T.Color().setHSL((hsl.h + 1 / 6) % 1, Math.max(hsl.s, 0.6), Math.min(Math.max(hsl.l, 0.35), 0.7));
            const c = this.change(t); c.recolor = true; c.color = { r: n.r, g: n.g, b: n.b }; this.apply(); break;
          }
          case V.Finish: { const c = this.change(t); c.refinish = true; c.finish = Math.max(0, Math.min(10, Math.round(a.a))); this.apply(); break; }
          case V.Glow: { const c = this.change(t); c.glow = c.glow > 0 ? 0 : (a.a || 1.5); this.apply(); break; }
          case V.GoToState: this.setState(Math.round(a.a)); break;
          case V.NextState: this.setState((this.state + 1) % Math.max(1, this.states.length)); break;
          case V.Spin: case V.Wobble: case V.Grow: {
            const dur = a.verb === V.Spin ? Math.max(0.3, Math.abs(a.a) * 0.9) : a.verb === V.Wobble ? Math.max(0.2, a.a) : 0.7;
            this.anims = this.anims.filter((x) => !(x.kind === a.verb && this.same(x.t, t)));
            this.anims.push({ t, kind: a.verb, t0: performance.now() / 1000, dur, amount: a.a, pivot: this.pivot(t) });
            break;
          }
          case V.Sound: Sound.play(Math.round(a.a)); break;
          case V.Buzz: if (navigator.vibrate) navigator.vibrate(Math.round(60 + 140 * (a.a || 0.5))); break;
          case V.Sparkles: if (this.sparkle) this.sparkle(this.pivot(t), a.color); break;
          case V.Wait: await sleep(Math.min(10, a.a || 1) * 1000); break;
        }
      }
    }

    pose(now) {
      this.anims = this.anims.filter((a) => now - a.t0 <= a.dur);
      const q = new T.Quaternion(), tmp = new T.Vector3(), Y = new T.Vector3(0, 1, 0), Z = new T.Vector3(0, 0, 1);
      for (const { part, objs } of this.parts.values()) {
        for (const b of objs) {
          const pos = b.pos.clone(), quat = b.quat.clone();
          let k = 1;
          for (const a of this.anims) {
            if (!this.covers(a.t, part)) continue;
            const f = Math.min(1, Math.max(0, (now - a.t0) / a.dur));
            let s = 1;
            q.identity();
            if (a.kind === V.Spin) { const e = f * f * (3 - 2 * f); q.setFromAxisAngle(Y, Math.PI * 2 * a.amount * e); }
            else if (a.kind === V.Wobble) { const d = Math.exp(-f * 3); q.setFromAxisAngle(Z, (14 * Math.PI / 180) * Math.sin(f * Math.PI * 6) * d); s = 1 + 0.12 * Math.sin(f * Math.PI * 7) * d; }
            else if (a.kind === V.Grow) s = 1 + (a.amount - 1) * Math.sin(f * Math.PI);
            tmp.copy(pos).sub(a.pivot).multiplyScalar(s).applyQuaternion(q);
            pos.copy(a.pivot).add(tmp);
            quat.premultiply(q);
            k *= s;
          }
          b.o.position.copy(pos); b.o.quaternion.copy(quat); b.o.scale.copy(b.scale).multiplyScalar(k);
        }
      }
    }

    dispose() {
      this.alive = false;
      this.scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }
  }

  // ── THE GAME'S SOUNDS, MADE HERE (CreationSounds' recipes) ───────────────────────────────────────────────────

  const Sound = (() => {
    let ctx = null;
    const buffers = [];
    function synth(which, rate) {
      const len = which === 2 ? 1.2 : which === 5 ? 0.8 : which === 4 ? 0.6 : which === 7 ? 0.5 : which === 1 ? 0.38 : 0.28;
      const n = Math.ceil(len * rate), d = new Float32Array(n);
      let ph = 0, ph2 = 0, seed = 0x9E3779B9 >>> 0;
      const noise = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return (seed & 0xFFFF) / 32767.5 - 1; };
      const rep = (x) => x - Math.floor(x);
      for (let i = 0; i < n; i++) {
        const t = i / rate, f = t / len, env = Math.min(1, t * 200) * Math.max(0, 1 - f);
        let s = 0;
        switch (which) {
          case 0: { const fr = 1300 + 600 * Math.sin(Math.PI * f) + 40 * Math.sin(t * 90); ph += fr / rate; s = (rep(ph) < 0.3 ? 1 : -0.45) * env; break; }
          case 1: { const fr = 240 + 6 * Math.sin(t * 30); ph += fr / rate; ph2 += fr * 1.5 / rate; s = ((rep(ph) * 2 - 1) * 0.6 + (rep(ph2) * 2 - 1) * 0.4) * env; break; }
          case 2: s = (Math.sin(2 * Math.PI * 880 * t) + 0.5 * Math.sin(2 * Math.PI * 2430 * t) * Math.exp(-t * 6) + 0.3 * Math.sin(2 * Math.PI * 4750 * t) * Math.exp(-t * 10)) * Math.exp(-t * 3.5) * Math.min(1, t * 400); break;
          case 3: { const fr = 700 + (120 - 700) * Math.min(1, t * 14); ph += fr / rate; s = (Math.sin(2 * Math.PI * ph) * 0.8 + noise() * 0.4 * Math.exp(-t * 80)) * Math.exp(-t * 28); break; }
          case 4: { const fr = 160 + 90 * f + 60 * Math.sin(t * 55) * Math.exp(-t * 3); ph += fr / rate; s = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 4.5) * Math.min(1, t * 300); break; }
          case 5: { const note = Math.min(2, Math.floor(t / 0.12)), fr = [1046.5, 1318.5, 1568][note], tn = t - note * 0.12; s = (Math.sin(2 * Math.PI * fr * tn) + 0.3 * Math.sin(2 * Math.PI * fr * 2.01 * tn)) * Math.exp(-tn * 6) * Math.min(1, tn * 500); break; }
          case 6: { const fr = 110 + (48 - 110) * Math.min(1, t * 8); ph += fr / rate; s = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 11) + noise() * 0.35 * Math.exp(-t * 45); break; }
          case 7: { const e = f * f * (3 - 2 * f), fr = 900 + (2200 - 900) * e + 30 * Math.sin(t * 40); ph += fr / rate; s = Math.sin(2 * Math.PI * ph) * env; break; }
          case 8: { const fr = 2400 + (150 - 2400) * Math.pow(f, 0.6); ph += fr / rate; s = (rep(ph) < 0.5 ? 0.7 : -0.7) * env; break; }
          default: { const fr = t < 0.11 ? 660 : 990, tn = t < 0.11 ? t : t - 0.11; ph += fr / rate; s = (rep(ph) < 0.5 ? 0.6 : -0.6) * Math.exp(-tn * 18) * Math.min(1, tn * 600); }
        }
        d[i] = s;
      }
      let peak = 0; for (const x of d) peak = Math.max(peak, Math.abs(x));
      if (peak > 1e-5) for (let i = 0; i < n; i++) d[i] *= 0.8 / peak;
      return d;
    }
    function play(i) {
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        i = Math.max(0, Math.min(SOUNDS.length - 1, i | 0));
        if (!buffers[i]) { const d = synth(i, 22050); const b = ctx.createBuffer(1, d.length, 22050); b.copyToChannel(d, 0); buffers[i] = b; }
        const src = ctx.createBufferSource(), g = ctx.createGain();
        g.gain.value = 0.5;
        src.buffer = buffers[i]; src.connect(g); g.connect(ctx.destination); src.start();
      } catch (e) { /* no sound in this browser */ }
    }
    return { play };
  })();

  // ── SETTING A SCENE ───────────────────────────────────────────────────────────────────────────────────────────

  function stage() {
    const scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xfff4e6, 0x3a2a22, 0.95));
    const sun = new T.DirectionalLight(0xffffff, 0.85); sun.position.set(-1.2, 2, 2.2); scene.add(sun);
    const rim = new T.DirectionalLight(0xffd9a8, 0.35); rim.position.set(2, 1, -2); scene.add(rim);
    return scene;
  }

  function frame(cam, obj, controls) {
    const box = new T.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const c = box.getCenter(new T.Vector3()), r = Math.max(0.01, box.getSize(new T.Vector3()).length() * 0.5);
    const d = r / Math.sin((cam.fov * Math.PI / 180) / 2) * 1.05;
    cam.near = d / 100; cam.far = d * 10; cam.updateProjectionMatrix();
    cam.position.copy(c).add(new T.Vector3(0.45, 0.32, 1).normalize().multiplyScalar(d));
    cam.lookAt(c);
    if (controls) { controls.target.copy(c); controls.update(); }
  }

  // ── CARD STILLS (one shared renderer) ─────────────────────────────────────────────────────────────────────────

  let shared = null;
  const queue = [];
  let busy = false;
  function still(canvas, base, rec) {
    queue.push({ canvas, base, rec });
    if (!busy) drain();
  }
  async function drain() {
    busy = true;
    while (queue.length) {
      const { canvas, base, rec } = queue.shift();
      if (!canvas.isConnected) continue;
      try {
        if (!shared) { shared = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); shared.outputEncoding = T.sRGBEncoding; }
        const w = canvas.clientWidth || 300, h = canvas.clientHeight || 240, dpr = Math.min(2, window.devicePixelRatio || 1);
        shared.setSize(w * dpr, h * dpr, false);
        const [details, buf] = await fetchToy(base, rec.id);
        const scene = await parse(buf);
        const toy = new Toy(scene, details);
        const s = stage(); s.add(scene);
        const cam = new T.PerspectiveCamera(35, w / h, 0.01, 100);
        frame(cam, scene);
        shared.render(s, cam);
        canvas.width = w * dpr; canvas.height = h * dpr;
        canvas.getContext('2d').drawImage(shared.domElement, 0, 0);
        toy.dispose();
      } catch (e) {
        const g = canvas.getContext('2d');
        g.fillStyle = 'rgba(255,255,255,.4)'; g.font = '14px sans-serif'; g.fillText("couldn't load", 12, 24);
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    busy = false;
  }

  // ── THE PLAYER ────────────────────────────────────────────────────────────────────────────────────────────────

  let live = null;
  function close() {
    if (!live) return;
    live.alive = false;
    cancelAnimationFrame(live.raf);
    clearInterval(live.timer);
    live.toy.dispose();
    live.renderer.dispose();
    live.box.remove();
    document.removeEventListener('keydown', live.onKey);
    live = null;
  }

  function nameOf(info, t) {
    if (!t || t.kind === 0) return 'the whole toy';
    if (t.kind === 1) { const p = (info.parts || []).find((x) => x.id === t.id); return p ? (p.name || 'a piece') : 'a piece'; }
    const g = (info.groups || []).find((x) => x.id === t.id); return g ? g.name : 'a group';
  }

  function ruleHtml(info, r) {
    let when = TRIGGERS[r.when] || '?';
    if (r.when === TR.Every) when += ` ${(+r.every).toFixed(1).replace(/\.0$/, '')} s`;
    if (r.when === TR.EnteredState) { const s = (info.states || [])[Math.round(r.every)]; when += ` ${s ? s.name : Math.round(r.every)}`; }
    const head = `<span class="ty-blk ty-when">WHEN ${esc(when)}</span>` + (r.when === TR.Touched ? `<span class="ty-blk ty-on">ON ${esc(nameOf(info, r.on).toUpperCase())}</span>` : '');
    const acts = (r.acts || []).map((a) => {
      let txt = VERBS[a.verb] || '?';
      const targeted = ![V.GoToState, V.NextState, V.Sound, V.Buzz, V.Wait].includes(a.verb);
      if (targeted) txt += ' ' + nameOf(info, a.target).toUpperCase();
      if (a.verb === V.Sound) txt += ' ' + (SOUNDS[Math.round(a.a)] || '');
      if (a.verb === V.GoToState) { const s = (info.states || [])[Math.round(a.a)]; txt += ' ' + (s ? s.name : Math.round(a.a)); }
      if (a.verb === V.Finish) txt += ' ' + (FINISHES[Math.round(a.a)] || '').toUpperCase();
      if (a.verb === V.Wait) txt += ` ${(+a.a).toFixed(1)} s`;
      const sw = a.verb === V.Colour ? `<i class="ty-sw" style="background:rgb(${Math.round(a.color.r * 255)},${Math.round(a.color.g * 255)},${Math.round(a.color.b * 255)})"></i>` : '';
      return (a.wait > 0 ? `<span class="ty-blk ty-wait">WAIT ${(+a.wait).toFixed(2).replace(/0$/, '')} s</span>` : '') + `<span class="ty-blk ty-do">${sw}${esc(txt)}</span>`;
    }).join('');
    return `<div class="ty-rule">${head}<span class="ty-arrow">→</span>${acts || '<span class="ty-blk">nothing yet</span>'}</div>`;
  }

  async function open(base, rec) {
    close();
    const box = document.createElement('div');
    box.className = 'ty-player';
    box.innerHTML = `
      <div class="ty-backdrop"></div>
      <div class="ty-card" role="dialog" aria-modal="true" aria-label="${esc(rec.name || 'Toy')}">
        <button type="button" class="ty-x" aria-label="Close">✕</button>
        <h2 class="ty-title">${esc(rec.name || 'Toy')}</h2>
        <p class="ty-by">made by ${esc(rec.author || 'someone')} in BARK's Workshop</p>
        <div class="ty-stage"><canvas class="ty-canvas"></canvas><p class="ty-hint">Drag to turn it · click a piece to TOUCH it</p></div>
        <div class="ty-row ty-states"></div>
        <div class="ty-row ty-events"></div>
        <div class="ty-rules"></div>
      </div>`;
    document.body.appendChild(box);
    const canvas = box.querySelector('.ty-canvas');
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const me = live = { box, renderer, alive: true, raf: 0, timer: 0, toy: null, onKey: (e) => { if (e.key === 'Escape') close(); } };
    box.querySelector('.ty-x').addEventListener('click', close);
    box.querySelector('.ty-backdrop').addEventListener('click', close);
    document.addEventListener('keydown', me.onKey);

    let details, buf;
    try { [details, buf] = await fetchToy(base, rec.id); }
    catch (e) { box.querySelector('.ty-hint').textContent = "Couldn't load this toy right now."; return; }
    if (!me.alive) return;
    const scene = await parse(buf);
    if (!me.alive) return;
    const toy = me.toy = new Toy(scene, details);
    const info = toy.info;
    const s = stage(); s.add(scene);
    const cam = new T.PerspectiveCamera(35, 1, 0.01, 100);
    const controls = T.OrbitControls ? new T.OrbitControls(cam, canvas) : null;
    if (controls) { controls.enableDamping = true; controls.enablePan = false; }

    // Sparkles: a little burst of points.
    const bursts = [];
    toy.sparkle = (at, col) => {
      const n = 30, g = new T.BufferGeometry(), pos = new Float32Array(n * 3), vel = [];
      const size = new T.Box3().setFromObject(scene).getSize(new T.Vector3()).length();
      for (let i = 0; i < n; i++) { pos.set([at.x, at.y, at.z], i * 3); vel.push(new T.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).multiplyScalar(size * 0.9)); }
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      const m = new T.PointsMaterial({ size: size * 0.025, color: new T.Color(col.r, col.g, col.b).convertSRGBToLinear(), transparent: true });
      const pts = new T.Points(g, m);
      toy.root.add(pts);
      bursts.push({ pts, vel, t: 0 });
    };

    // States: a button each.
    const statesRow = box.querySelector('.ty-states');
    const drawStates = () => {
      const n = Math.max(1, toy.states.length);
      statesRow.innerHTML = '<span class="ty-label">STATES</span>' + Array.from({ length: n }, (_, i) =>
        `<button type="button" class="ty-btn${i === toy.state ? ' is-on' : ''}" data-state="${i}">${esc(i === 0 ? 'AS BUILT' : (toy.states[i] && toy.states[i].name) || 'STATE ' + i)}</button>`).join('');
      statesRow.querySelectorAll('[data-state]').forEach((b) => b.addEventListener('click', () => toy.setState(+b.dataset.state)));
    };
    toy.onState = drawStates;
    drawStates();

    // The holder's events, for the rules that use them.
    const ev = [[TR.Clicked, 'CLICK'], [TR.ButtonA, 'A / X'], [TR.Grabbed, 'GRAB'], [TR.LetGo, 'LET GO'], [TR.Shaken, 'SHAKE'], [TR.Thrown, 'THROW'], [TR.Landed, 'LAND']]
      .filter(([w]) => toy.rules.some((r) => r.when === w));
    box.querySelector('.ty-events').innerHTML = ev.length ? '<span class="ty-label">DO</span>' + ev.map(([w, l]) => `<button type="button" class="ty-btn" data-when="${w}">${l}</button>`).join('') : '';
    box.querySelectorAll('[data-when]').forEach((b) => b.addEventListener('click', () => toy.fire(+b.dataset.when)));

    // The code blocks, as blocks.
    box.querySelector('.ty-rules').innerHTML = toy.rules.length
      ? '<h3>WHAT IT DOES</h3>' + toy.rules.map((r) => ruleHtml(info, r)).join('')
      : '<p class="ty-none">This toy has no rules yet - it just looks great.</p>';

    // Clicking a piece = touching it (and a click).
    const ray = new T.Raycaster(), mouse = new T.Vector2();
    let down = null;
    canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
      down = null;
      const r = canvas.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, cam);
      const hit = ray.intersectObject(scene, true).find((h) => h.object.visible && h.object.userData.part != null);
      if (hit) toy.fire(TR.Touched, hit.object.userData.part);
      toy.fire(TR.Clicked);
    });

    // Every n seconds, and started.
    const lastEvery = new Map();
    me.timer = setInterval(() => {
      const now = performance.now() / 1000;
      toy.rules.forEach((r, i) => {
        if (r.when !== TR.Every) return;
        if (now - (lastEvery.get(i) || now - 0.001) >= Math.max(0.25, r.every)) { lastEvery.set(i, now); toy.run(i); }
        if (!lastEvery.has(i)) lastEvery.set(i, now);
      });
    }, 100);
    toy.fire(TR.Started);

    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
        renderer.setSize(w, h, false);
        cam.aspect = w / Math.max(1, h); cam.updateProjectionMatrix();
      }
    };
    resize();
    frame(cam, scene, controls);
    let last = performance.now();
    const loop = () => {
      if (!me.alive) return;
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
      resize();
      toy.pose(now / 1000);
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i]; b.t += dt;
        const p = b.pts.geometry.attributes.position;
        for (let k = 0; k < b.vel.length; k++) { b.vel[k].y -= dt * 0.6 * b.vel[k].length(); p.setXYZ(k, p.getX(k) + b.vel[k].x * dt, p.getY(k) + b.vel[k].y * dt, p.getZ(k) + b.vel[k].z * dt); }
        p.needsUpdate = true;
        b.pts.material.opacity = Math.max(0, 1 - b.t / 0.9);
        if (b.t > 0.9) { toy.root.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose(); bursts.splice(i, 1); }
      }
      if (controls) controls.update();
      renderer.render(s, cam);
      me.raf = requestAnimationFrame(loop);
    };
    me.raf = requestAnimationFrame(loop);
  }

  return { still, open, close };
})();
