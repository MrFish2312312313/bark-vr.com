/* ============================
   BARKVR — seasons/winter.js
   The moving parts of the WINTER dress (season.js loads it with seasons/winter.css):
   - SNOW: one canvas behind the page. The flakes ride along with your scroll at their own depth (near flakes
     move more than far ones), and a fast scroll streaks them.
   - LIGHTS: bulbs hung on a black wire under the menu bar, each twinkling on its own clock.
   - SNOW BURSTS: hover the BARK logo and it puffs snow; press any button and snow bursts from it.
   - THE STAR: click it ten times and Sleigh Run opens - fly over Bark Island and drop presents to the players
     below, with a leaderboard. The board lives on Bark Manager at /api/sleigh/scores
     (GET -> { scores: [{ name, score, at }] } best first, POST { name, score }); until that route exists,
     scores are kept on this device.
   With reduced motion asked for: still snow, no bursts, no twinkling. 🍍
   ============================ */
(function () {
  'use strict';
  var root = document.documentElement;
  if (root.getAttribute('data-season') !== 'winter') return;
  root.classList.add('wx-js');

  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dprOf = function () { return Math.min(window.devicePixelRatio || 1, 2); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  var nice = function (s) {
    s = String(s == null ? '' : s).trim();
    return typeof window.barkName === 'function' ? window.barkName(s) : s;
  };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };

  // ── Snow behind the page ────────────────────────────────────────────────────────────────────

  function snow() {
    var c = document.createElement('canvas');
    c.className = 'wx-snow';
    c.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(c, document.body.firstChild);
    var ctx = c.getContext('2d');
    var W = 0, H = 0, flakes = [], lastY = window.scrollY, vel = 0, last = performance.now();

    function make(anywhere) {
      var z = 0.15 + Math.pow(Math.random(), 1.6) * 0.85;          // depth: 1 = close, big, fast
      return { x: Math.random() * W, y: anywhere ? Math.random() * H : -6, z: z, r: 0.6 + z * 2.3,
               s: 14 + z * 42, p: Math.random() * 6.283, w: 0.4 + Math.random() * 0.9 };
    }
    function size() {
      var d = dprOf();
      W = window.innerWidth; H = window.innerHeight;
      c.width = Math.round(W * d); c.height = Math.round(H * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      var want = Math.min(230, Math.round(W * H / 6500));
      while (flakes.length < want) flakes.push(make(true));
      flakes.length = want;
      if (reduced) draw(0);
    }
    function draw(v) {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = ctx.strokeStyle = '#ffffff';
      ctx.lineCap = 'round';
      for (var i = 0; i < flakes.length; i++) {
        var f = flakes[i];
        ctx.globalAlpha = 0.25 + f.z * 0.6;
        var streak = v * f.z * 1.4;                                // fast scroll: the flake smears along it
        if (Math.abs(streak) > 2) {
          ctx.lineWidth = f.r * 1.6;
          ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x, f.y + streak); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.283); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    function frame(now) {
      requestAnimationFrame(frame);
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (document.hidden) return;
      var dy = window.scrollY - lastY; lastY = window.scrollY;
      vel = vel * 0.8 + dy * 0.2;
      var t = now / 1000;
      for (var i = 0; i < flakes.length; i++) {
        var f = flakes[i];
        f.y += f.s * dt - dy * f.z * 0.65;                         // parallax: near flakes ride the scroll most
        f.x += Math.sin(t * f.w + f.p) * f.z * 14 * dt;
        if (f.y > H + 8) { f.y -= H + 16; f.x = Math.random() * W; }
        else if (f.y < -8) { f.y += H + 16; f.x = Math.random() * W; }
        if (f.x < -8) f.x += W + 16; else if (f.x > W + 8) f.x -= W + 16;
      }
      draw(vel);
    }
    window.addEventListener('resize', size);
    size();
    if (!reduced) requestAnimationFrame(frame);
  }

  // ── Lights on a wire under the menu bar ─────────────────────────────────────────────────────

  function lights() {
    var nav = document.querySelector('nav');
    if (!nav) return;
    var box = document.createElement('div');
    box.className = 'wx-lights';
    box.setAttribute('aria-hidden', 'true');
    nav.appendChild(box);
    var COLORS = ['#ff4d5a', '#ffd36b', '#57d98a', '#7ec8ff', '#fff3d6'];
    var builtFor = 0;
    function build() {
      var w = nav.clientWidth;
      if (!w || w === builtFor) return;
      builtFor = w;
      var gap = w < 600 ? 44 : 58, n = Math.ceil(w / gap) + 1, d = 'M0 3';
      for (var i = 0; i < n; i++) d += ' Q' + (i * gap + gap / 2) + ' 15 ' + ((i + 1) * gap) + ' 3';
      var html = '<svg class="wx-wire" width="' + (n * gap) + '" height="16" viewBox="0 0 ' + (n * gap) + ' 16"><path d="' + d + '"/></svg>';
      for (var j = 0; j < n; j++) {
        html += '<span class="wx-bulb" style="left:' + (j * gap + gap / 2) + 'px;--c:' + COLORS[j % COLORS.length] +
                ';--d:' + (0.9 + Math.random() * 2.3).toFixed(2) + 's;--o:' + (-Math.random() * 3).toFixed(2) +
                's;--r:' + Math.round(Math.random() * 26 - 13) + 'deg"></span>';
      }
      box.innerHTML = html;
    }
    var t = 0;
    window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(build, 120); });
    build();
  }

  // ── Snow bursts (over everything) ───────────────────────────────────────────────────────────

  var fx = (function () {
    if (reduced) return { burst: function () {}, puff: function () {} };
    var c = null, ctx = null, parts = [], raf = 0, last = 0, W = 0, H = 0;
    function ensure() {
      if (c) return;
      c = document.createElement('canvas');
      c.className = 'wx-fx';
      c.setAttribute('aria-hidden', 'true');
      document.body.appendChild(c);
      ctx = c.getContext('2d');
      size();
      window.addEventListener('resize', size);
    }
    function size() {
      var d = dprOf();
      W = window.innerWidth; H = window.innerHeight;
      c.width = Math.round(W * d); c.height = Math.round(H * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
    }
    function add(p) {
      ensure();
      if (parts.length > 400) return;
      parts.push(p);
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); }
    }
    function particle(x, y, vx, vy, big) {
      var life = 0.7 + Math.random() * 0.9;
      add({ x: x, y: y, vx: vx, vy: vy, life: life, max: life, r: (big ? 2.2 : 1.2) + Math.random() * 2,
            flake: Math.random() < 0.4, rot: Math.random() * 6.283, spin: (Math.random() - 0.5) * 6 });
    }
    function burst(x, y, n) {
      n = n || 16;
      for (var i = 0; i < n; i++) {
        var a = Math.random() * 6.283, s = 60 + Math.random() * 190;
        particle(x, y, Math.cos(a) * s, Math.sin(a) * s - 70, true);
      }
    }
    function puff(rect) {
      var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      var x = rect.left + Math.random() * rect.width, y = rect.top + Math.random() * rect.height;
      particle(x, y, (x - cx) / rect.width * 160 + (Math.random() - 0.5) * 30, (y - cy) / rect.height * 80 - 40, false);
    }
    function step(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = ctx.fillStyle = '#ffffff';
      ctx.lineCap = 'round';
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i];
        p.life -= dt;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        p.vy = Math.min(p.vy + 160 * dt, 110);                    // falls like snow, not like a stone
        p.vx *= 1 - 2.2 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt;
        ctx.globalAlpha = Math.min(1, p.life / p.max * 1.6);
        if (p.flake) {
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          for (var k = 0; k < 3; k++) {
            var a = p.rot + k * 1.047, dx = Math.cos(a) * p.r * 1.8, dy = Math.sin(a) * p.r * 1.8;
            ctx.moveTo(p.x - dx, p.y - dy); ctx.lineTo(p.x + dx, p.y + dy);
          }
          ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      raf = parts.length ? requestAnimationFrame(step) : 0;
      if (!raf) ctx.clearRect(0, 0, W, H);
    }
    return { burst: burst, puff: puff };
  })();

  var BUTTONS = 'button, [role="button"], input[type="submit"], input[type="button"], .btn-primary, .btn-secondary, a[class*="btn"]';

  function bursts() {
    document.addEventListener('pointerdown', function (e) {
      var b = e.target.closest && e.target.closest(BUTTONS);
      if (b && !b.classList.contains('wx-star')) fx.burst(e.clientX, e.clientY, 16);
    }, true);
    document.querySelectorAll('.nav-logo-img, .hero-logo-img').forEach(function (img) {
      var timer = 0;
      img.addEventListener('mouseenter', function () {
        var r = img.getBoundingClientRect();
        for (var i = 0; i < 8; i++) fx.puff(r);
        clearInterval(timer);
        timer = setInterval(function () { fx.puff(img.getBoundingClientRect()); }, 60);
      });
      img.addEventListener('mouseleave', function () { clearInterval(timer); });
    });
  }

  // ── The star (ten clicks = Sleigh Run) ──────────────────────────────────────────────────────

  function star() {
    var host = document.querySelector('.hero') || document.querySelector('.page-hero');
    if (!host) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'wx-star' + (host.classList.contains('page-hero') ? ' wx-star-sm' : '');
    b.setAttribute('aria-label', 'Gold star');
    host.appendChild(b);
    var n = 0, idle = 0;
    b.addEventListener('click', function () {
      n++;
      clearTimeout(idle);
      idle = setTimeout(function () { n = 0; b.style.setProperty('--heat', 0); }, 3000);
      b.style.setProperty('--heat', Math.min(1, n / 10));
      b.classList.remove('wx-pop'); void b.offsetWidth; b.classList.add('wx-pop');
      var r = b.getBoundingClientRect();
      fx.burst(r.left + r.width / 2, r.top + r.height / 2, 6 + n * 2);
      if (n >= 10) { n = 0; b.style.setProperty('--heat', 0); Sleigh.open(); }
    });
  }

  // ── Sleigh Run ──────────────────────────────────────────────────────────────────────────────

  var Sleigh = (function () {
    var W = 960, H = 540, SX = 230, SEA = 478, LAP = 4600, LAND0 = 600, LAND1 = 4000, ROUND = 60;
    var BOARD_KEY = 'wx_sleigh_board', NAME_KEY = 'wx_sleigh_name';
    var FALLBACK = ['Tony', 'Fish', 'Beanie', 'Puke', 'Goek', 'Bum', 'Kevin', 'Greg', 'Dumba', 'Lizard', 'Puffy', 'Pig'];
    var el = null, cv, ctx, panel, dropBtn, raf = 0, last = 0, state = 'menu', g = null;
    var backend = null, names = null, font = 'sans-serif', stars = [];

    // backend + names + board
    function backendUrl() {
      if (backend !== null) return Promise.resolve(backend);
      return fetch('/backend-url.json?t=' + Date.now()).then(function (r) { return r.json(); })
        .then(function (j) { backend = String((j && j.backendUrl) || '').replace(/\/$/, ''); return backend; })
        .catch(function () { backend = ''; return backend; });
    }
    function loadNames() {
      if (names) return;
      names = FALLBACK.slice();
      backendUrl().then(function (b) {
        if (!b) return null;
        return fetch(b + '/linked-profiles').then(function (r) { return r.ok ? r.json() : null; });
      }).then(function (j) {
        var list = j && j.profiles ? j.profiles.map(function (p) { return nice(p.displayName); }).filter(Boolean) : [];
        if (list.length >= 4) names = list;
      }).catch(function () {});
    }
    function localBoard() {
      try { return JSON.parse(store.get(BOARD_KEY) || '[]'); } catch (e) { return []; }
    }
    function getBoard() {
      return backendUrl().then(function (b) {
        if (!b) throw 0;
        return fetch(b + '/api/sleigh/scores', { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw 0;
          return r.json().then(function (j) { return { online: true, scores: (j.scores || []).slice(0, 10) }; });
        });
      }).catch(function () { return { online: false, scores: localBoard().slice(0, 10) }; });
    }
    function saveScore(name, score) {
      var keep = function () {
        var l = localBoard();
        l.push({ name: name, score: score, at: Date.now() });
        l.sort(function (a, b) { return b.score - a.score; });
        store.set(BOARD_KEY, JSON.stringify(l.slice(0, 10)));
      };
      return backendUrl().then(function (b) {
        if (!b) { keep(); return; }
        return fetch(b + '/api/sleigh/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                   body: JSON.stringify({ name: name, score: score }) })
          .then(function (r) { if (!r.ok) keep(); });
      }).catch(keep);
    }
    function boardHtml(board, mine) {
      var rows = board.scores.length ? board.scores.map(function (s, i) {
        var me = mine && s.name === mine.name && s.score === mine.score;
        return '<li' + (me ? ' class="wx-me"' : '') + '><span>' + (i + 1) + '.</span><b>' + esc(nice(s.name) || 'Someone') +
               '</b><em>' + (s.score | 0) + '</em></li>';
      }).join('') : '<li class="wx-empty">No scores yet - be the first!</li>';
      return '<div class="wx-board"><h3>Leaderboard</h3><ol>' + rows + '</ol>' +
             (board.online ? '' : '<p class="wx-note">Scores on this device</p>') + '</div>';
    }

    // the island
    function ground(x) {
      var l = ((x % LAP) + LAP) % LAP;
      if (l < LAND0 || l > LAND1) return null;
      var e = Math.min(1, Math.min(l - LAND0, LAND1 - l) / 190);
      e = e * e * (3 - 2 * e);
      var hills = Math.sin(l / 210) * 22 + Math.sin(l / 77 + 1.3) * 8;
      return SEA - e * (64 + hills);
    }
    function buildLap(k) {
      var x0 = k * LAP, x = x0 + LAND0 + 180;
      g.signs.push({ x: x0 + LAND0 + 90 });
      for (var t = x0 + LAND0 + 40; t < x0 + LAND1 - 40; t += 60 + Math.random() * 140)
        g.trees.push({ x: t, s: 0.7 + Math.random() * 0.6 });
      while (x < x0 + LAND1 - 150) {
        if (Math.random() < 0.76) g.people.push({ x: x, name: names[Math.floor(Math.random() * names.length)], done: false, passed: false, ph: Math.random() * 6 });
        else g.houses.push({ x: x });
        x += 170 + Math.random() * 170;
      }
      g.built = k;
    }
    function newGame(playing) {
      g = { t: 0, left: ROUND, score: 0, combo: 0, best: 0, delivered: 0, missed: 0, speed: playing ? 170 : 90,
            wx: 0, presents: [], pops: [], cool: 0, people: [], houses: [], trees: [], signs: [], built: -1,
            flakes: [] };
      for (var i = 0; i < 70; i++) g.flakes.push({ x: Math.random() * W, y: Math.random() * H, z: 0.3 + Math.random() * 0.7 });
      buildLap(0);
    }

    // input
    function drop() {
      if (state !== 'play' || g.cool > 0) return;
      g.cool = 0.38;
      g.presents.push({ wx: g.wx + SX + 8, y: sleighY() + 14, vy: 30, rot: 0, spin: (Math.random() - 0.5) * 6,
                        c: ['#e63946', '#2f9e5b', '#ffce5c', '#4c8be8'][Math.floor(Math.random() * 4)], dead: 0 });
    }
    function sleighY() { return 118 + Math.sin(g.t * 1.7) * 9; }
    function pop(x, y, text, color) { g.pops.push({ x: x, y: y, text: text, color: color || '#fff', life: 1.1 }); }

    // update
    function update(dt) {
      g.t += dt;
      if (state === 'play') {
        g.left -= dt;
        g.speed = 170 + (ROUND - g.left) * 2.7;
        if (g.cool > 0) g.cool -= dt;
        if (g.left <= 0) { g.left = 0; finish(); }
      }
      g.wx += g.speed * dt;
      if (g.wx + W * 2 > (g.built + 1) * LAP) buildLap(g.built + 1);

      for (var i = g.presents.length - 1; i >= 0; i--) {
        var p = g.presents[i];
        if (p.dead) { p.dead -= dt; if (p.dead <= 0) g.presents.splice(i, 1); continue; }
        p.vy += 540 * dt;
        p.y += p.vy * dt;
        p.wx += g.speed * 0.72 * dt;                               // keeps flying forward, a bit slower than the sleigh
        p.rot += p.spin * dt;
        var hit = null, best = 99;
        for (var j = 0; j < g.people.length; j++) {
          var q = g.people[j];
          if (q.done) continue;
          var dx = Math.abs(q.x - p.wx), top = ground(q.x) - 40;
          if (dx < 18 && p.y >= top && dx < best) { hit = q; best = dx; }
        }
        var sx = p.wx - g.wx;
        if (hit) {
          hit.done = true;
          g.combo++; g.best = Math.max(g.best, g.combo); g.delivered++;
          var perfect = best < 7, pts = (perfect ? 3 : 1) * Math.min(g.combo, 5);
          g.score += pts;
          pop(hit.x - g.wx, ground(hit.x) - 64, (perfect ? 'PERFECT! +' : '+') + pts, perfect ? '#ffd36b' : '#ffffff');
          g.presents.splice(i, 1);
          continue;
        }
        var gy = ground(p.wx);
        if ((gy === null && p.y >= SEA) || (gy !== null && p.y >= gy - 5)) {
          p.y = gy === null ? SEA + 6 : gy - 5; p.dead = gy === null ? 0.25 : 0.9; p.spin = 0;
          if (state === 'play') {
            if (g.combo > 1) pop(sx, p.y - 26, 'combo lost', '#ff9aa5');
            g.combo = 0;
          }
        }
      }
      for (var m = g.people.length - 1; m >= 0; m--) {
        var q2 = g.people[m], qx = q2.x - g.wx;
        if (!q2.done && !q2.passed && qx < 60 && state === 'play') { q2.passed = true; g.missed++; g.combo = 0; }
        if (qx < -80) g.people.splice(m, 1);
      }
      var cull = function (arr) { while (arr.length && arr[0].x - g.wx < -120) arr.shift(); };
      cull(g.houses); cull(g.trees); cull(g.signs);
      for (var n = g.pops.length - 1; n >= 0; n--) { g.pops[n].life -= dt; g.pops[n].y -= 34 * dt; if (g.pops[n].life <= 0) g.pops.splice(n, 1); }
      for (var f = 0; f < g.flakes.length; f++) {
        var fl = g.flakes[f];
        fl.y += (20 + fl.z * 40) * dt; fl.x -= g.speed * fl.z * 0.35 * dt;
        if (fl.y > H) fl.y -= H; if (fl.x < 0) fl.x += W;
      }
    }

    // drawing
    function draw() {
      var t = g.t;
      var sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#040f1c'); sky.addColorStop(0.6, '#0b2c3d'); sky.addColorStop(1, '#134457');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t * s.w + s.p));
        ctx.fillStyle = '#fff'; ctx.fillRect(s.x, s.y, s.r, s.r);
      }
      ctx.globalAlpha = 1;
      var moon = ctx.createRadialGradient(812, 92, 10, 812, 92, 90);
      moon.addColorStop(0, 'rgba(255,248,220,0.35)'); moon.addColorStop(1, 'rgba(255,248,220,0)');
      ctx.fillStyle = moon; ctx.fillRect(700, 0, 230, 200);
      ctx.fillStyle = '#fff6dc'; ctx.beginPath(); ctx.arc(812, 92, 30, 0, 6.283); ctx.fill();

      // far hills
      ctx.fillStyle = '#0a2532';
      ctx.beginPath(); ctx.moveTo(0, H);
      for (var x = 0; x <= W; x += 12) {
        var wx = x + g.wx * 0.18;
        ctx.lineTo(x, 380 - Math.sin(wx / 160) * 34 - Math.sin(wx / 63 + 2) * 12);
      }
      ctx.lineTo(W, H); ctx.fill();

      // sea
      ctx.fillStyle = '#0b3550'; ctx.fillRect(0, SEA, W, H - SEA);
      ctx.strokeStyle = 'rgba(160,220,255,0.25)'; ctx.lineWidth = 2;
      for (var r = 0; r < 3; r++) {
        ctx.beginPath();
        for (var x2 = 0; x2 <= W; x2 += 10) {
          var y2 = SEA + 14 + r * 18 + Math.sin((x2 + g.wx * (0.6 + r * 0.2)) / 26 + t * 2) * 2;
          if (x2 === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2);
        }
        ctx.stroke();
      }

      // trees (behind the land's edge)
      for (var k = 0; k < g.trees.length; k++) tree(g.trees[k].x - g.wx, ground(g.trees[k].x), g.trees[k].s);

      // land
      var open = false;
      ctx.beginPath();
      for (var x3 = -6; x3 <= W + 6; x3 += 6) {
        var gy = ground(x3 + g.wx);
        if (gy === null) { if (open) { ctx.lineTo(x3, SEA + 30); open = false; } continue; }
        if (!open) { ctx.moveTo(x3, SEA + 30); open = true; }
        ctx.lineTo(x3, gy);
      }
      if (open) ctx.lineTo(W + 6, SEA + 30);
      var dirt = ctx.createLinearGradient(0, 370, 0, SEA + 30);
      dirt.addColorStop(0, '#2f6b3a'); dirt.addColorStop(1, '#4a3420');
      ctx.fillStyle = dirt; ctx.fill();
      ctx.strokeStyle = '#f4f8ff'; ctx.lineWidth = 7; ctx.lineJoin = 'round';
      ctx.beginPath(); open = false;
      for (var x4 = -6; x4 <= W + 6; x4 += 6) {
        var gy2 = ground(x4 + g.wx);
        if (gy2 === null) { open = false; continue; }
        if (!open) { ctx.moveTo(x4, gy2); open = true; } else ctx.lineTo(x4, gy2);
      }
      ctx.stroke();

      for (var a = 0; a < g.signs.length; a++) sign(g.signs[a].x - g.wx, ground(g.signs[a].x));
      for (var h = 0; h < g.houses.length; h++) house(g.houses[h].x - g.wx, ground(g.houses[h].x));
      for (var p = 0; p < g.people.length; p++) person(g.people[p], g.people[p].x - g.wx, ground(g.people[p].x));

      for (var q = 0; q < g.presents.length; q++) {
        var pr = g.presents[q];
        present(pr.wx - g.wx, pr.y, pr.rot, pr.c, pr.dead && pr.y >= SEA ? 0.4 : 1);
      }
      sleigh(SX, sleighY());

      ctx.fillStyle = '#fff';
      for (var f = 0; f < g.flakes.length; f++) {
        var fl = g.flakes[f];
        ctx.globalAlpha = 0.3 + fl.z * 0.5;
        ctx.beginPath(); ctx.arc(fl.x, fl.y, 0.8 + fl.z * 1.6, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;

      ctx.textAlign = 'center';
      for (var o = 0; o < g.pops.length; o++) {
        var pp = g.pops[o];
        ctx.globalAlpha = Math.min(1, pp.life * 2);
        ctx.font = 'bold 20px ' + font;
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(pp.text, pp.x, pp.y);
        ctx.fillStyle = pp.color; ctx.fillText(pp.text, pp.x, pp.y);
      }
      ctx.globalAlpha = 1;

      if (state === 'play') hud();
    }
    function hud() {
      ctx.font = 'bold 24px ' + font;
      ctx.textAlign = 'left';
      label('🎁 ' + g.score, 18, 36, '#ffffff');
      ctx.textAlign = 'center';
      label(Math.ceil(g.left) + 's', W / 2, 36, g.left < 10 ? '#ff8a94' : '#ffffff');
      ctx.textAlign = 'right';
      if (g.combo > 1) label('combo x' + Math.min(g.combo, 5), W - 18, 36, '#ffd36b');
    }
    function label(text, x, y, color) {
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.strokeText(text, x, y);
      ctx.fillStyle = color; ctx.fillText(text, x, y);
    }
    function tree(x, gy, s) {
      if (gy === null || x < -60 || x > W + 60) return;
      ctx.fillStyle = '#4a3420'; ctx.fillRect(x - 3 * s, gy - 14 * s, 6 * s, 16 * s);
      for (var i = 0; i < 3; i++) {
        var w = (26 - i * 6) * s, y = gy - (12 + i * 16) * s;
        ctx.fillStyle = '#1f5a3a';
        ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x, y - 26 * s); ctx.lineTo(x + w, y); ctx.fill();
        ctx.fillStyle = '#eef5ff';
        ctx.beginPath(); ctx.moveTo(x - w * 0.42, y - 15 * s); ctx.lineTo(x, y - 26 * s); ctx.lineTo(x + w * 0.42, y - 15 * s); ctx.fill();
      }
    }
    function house(x, gy) {
      if (gy === null || x < -60 || x > W + 60) return;
      ctx.fillStyle = '#6b4226'; ctx.fillRect(x - 24, gy - 30, 48, 32);
      ctx.fillStyle = '#ffd36b'; ctx.fillRect(x - 12, gy - 22, 10, 10);
      ctx.fillStyle = '#3a2414'; ctx.fillRect(x + 6, gy - 20, 10, 20);
      ctx.fillStyle = '#5a2a2a'; ctx.fillRect(x + 10, gy - 52, 8, 16);
      ctx.fillStyle = '#f4f8ff';
      ctx.beginPath(); ctx.moveTo(x - 30, gy - 28); ctx.lineTo(x, gy - 50); ctx.lineTo(x + 30, gy - 28); ctx.fill();
      ctx.fillStyle = 'rgba(220,230,240,0.35)';
      for (var i = 0; i < 3; i++) {
        var k = (g.t * 0.6 + i / 3) % 1;
        ctx.beginPath(); ctx.arc(x + 14 - k * 18, gy - 56 - k * 30, 3 + k * 5, 0, 6.283); ctx.fill();
      }
    }
    function sign(x, gy) {
      if (gy === null || x < -80 || x > W + 80) return;
      ctx.fillStyle = '#4a3420'; ctx.fillRect(x - 3, gy - 34, 6, 36);
      ctx.fillStyle = '#8a5a2b'; ctx.fillRect(x - 40, gy - 56, 80, 26);
      ctx.fillStyle = '#f4f8ff'; ctx.fillRect(x - 42, gy - 59, 84, 5);
      ctx.fillStyle = '#fff3d6'; ctx.font = 'bold 13px ' + font; ctx.textAlign = 'center';
      ctx.fillText('BARK ISLAND', x, gy - 38);
    }
    function person(q, x, gy) {
      if (gy === null || x < -60 || x > W + 60) return;
      var bob = q.done ? Math.abs(Math.sin(g.t * 6 + q.ph)) * 5 : 0, y = gy - bob;
      // the stump
      ctx.fillStyle = '#8a5a2b';
      ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x - 9, y - 34); ctx.lineTo(x + 9, y - 34); ctx.lineTo(x + 12, y); ctx.fill();
      ctx.fillStyle = '#a7743d'; ctx.fillRect(x - 9, y - 36, 18, 4);
      ctx.fillStyle = '#3fa34d';
      ctx.beginPath(); ctx.arc(x - 6, y - 38, 5, 0, 6.283); ctx.arc(x + 5, y - 39, 5, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#1a0f08';
      ctx.beginPath(); ctx.ellipse(x - 4, y - 25, 2.2, 3.2, 0, 0, 6.283); ctx.ellipse(x + 4, y - 25, 2.2, 3.2, 0, 0, 6.283); ctx.fill();
      // arms: waving for a present, holding one once it came
      ctx.strokeStyle = '#6b4226'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      if (q.done) {
        ctx.beginPath(); ctx.moveTo(x - 10, y - 18); ctx.lineTo(x - 4, y - 12); ctx.moveTo(x + 10, y - 18); ctx.lineTo(x + 4, y - 12); ctx.stroke();
        present(x, y - 12, 0, '#e63946', 1, 0.7);
        ctx.fillStyle = '#ff5d73'; ctx.font = '14px ' + font; ctx.textAlign = 'center';
        ctx.fillText('♥', x, y - 50 - Math.sin(g.t * 5 + q.ph) * 3);
      } else {
        var wave = Math.sin(g.t * 9 + q.ph) * 0.6;
        ctx.beginPath();
        ctx.moveTo(x + 10, y - 20); ctx.lineTo(x + 10 + Math.cos(-1 + wave) * 12, y - 20 + Math.sin(-1 + wave) * 12);
        ctx.moveTo(x - 10, y - 18); ctx.lineTo(x - 17, y - 12);
        ctx.stroke();
      }
      ctx.font = 'bold 12px ' + font; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(q.name, x, y - 52);
      ctx.fillStyle = q.done ? '#ffd36b' : '#ffffff'; ctx.fillText(q.name, x, y - 52);
    }
    function present(x, y, rot, color, alpha, scale) {
      var s = scale || 1;
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
      ctx.fillStyle = color; ctx.fillRect(-8, -8, 16, 16);
      ctx.fillStyle = '#fff3d6'; ctx.fillRect(-2, -8, 4, 16); ctx.fillRect(-8, -2, 16, 4);
      ctx.beginPath(); ctx.ellipse(-4, -10, 4, 2.5, -0.5, 0, 6.283); ctx.ellipse(4, -10, 4, 2.5, 0.5, 0, 6.283); ctx.fill();
      ctx.restore();
    }
    function sleigh(x, y) {
      var t = g.t;
      // reindeer
      var rx = x + 92, ry = y - 6 + Math.sin(t * 7) * 2;
      ctx.strokeStyle = '#d9b26b'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x + 30, y - 4); ctx.quadraticCurveTo(x + 60, y + 6, rx - 14, ry - 2); ctx.stroke();
      ctx.fillStyle = '#8a5a2b';
      ctx.beginPath(); ctx.ellipse(rx, ry, 18, 9, 0, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.ellipse(rx + 20, ry - 12, 7, 6, 0, 0, 6.283); ctx.fill();
      ctx.fillRect(rx + 12, ry - 12, 6, 10);
      ctx.strokeStyle = '#6b4226'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      var kick = Math.sin(t * 12) * 5;
      ctx.beginPath();
      ctx.moveTo(rx - 10, ry + 6); ctx.lineTo(rx - 16 - kick, ry + 18);
      ctx.moveTo(rx + 10, ry + 6); ctx.lineTo(rx + 14 + kick, ry + 18);
      ctx.stroke();
      ctx.strokeStyle = '#d9b26b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(rx + 18, ry - 17); ctx.lineTo(rx + 14, ry - 28); ctx.lineTo(rx + 8, ry - 31);
      ctx.moveTo(rx + 15, ry - 25); ctx.lineTo(rx + 21, ry - 31); ctx.stroke();
      var glow = ctx.createRadialGradient(rx + 27, ry - 12, 1, rx + 27, ry - 12, 10);
      glow.addColorStop(0, 'rgba(255,80,90,0.9)'); glow.addColorStop(1, 'rgba(255,80,90,0)');
      ctx.fillStyle = glow; ctx.fillRect(rx + 15, ry - 24, 24, 24);
      ctx.fillStyle = '#ff4d5a'; ctx.beginPath(); ctx.arc(rx + 27, ry - 12, 3, 0, 6.283); ctx.fill();
      // sparkle trail
      for (var i = 0; i < 8; i++) {
        var k = ((t * 1.6 + i / 8) % 1);
        ctx.globalAlpha = (1 - k) * 0.8;
        ctx.fillStyle = i % 2 ? '#ffd36b' : '#ffffff';
        ctx.fillRect(x - 34 - k * 120, y + 10 + Math.sin(i * 3 + t * 4) * 6, 3, 3);
      }
      ctx.globalAlpha = 1;
      // sack + driver
      ctx.fillStyle = '#7a5a3a'; ctx.beginPath(); ctx.ellipse(x - 14, y - 16, 14, 13, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#8a5a2b'; ctx.fillRect(x + 4, y - 28, 16, 22);
      ctx.fillStyle = '#1a0f08'; ctx.fillRect(x + 8, y - 22, 3, 4); ctx.fillRect(x + 14, y - 22, 3, 4);
      ctx.fillStyle = '#e63946';
      ctx.beginPath(); ctx.moveTo(x + 2, y - 28); ctx.lineTo(x + 22, y - 28); ctx.lineTo(x + 6, y - 44); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillRect(x + 1, y - 30, 22, 4);
      ctx.beginPath(); ctx.arc(x + 6, y - 45, 3, 0, 6.283); ctx.fill();
      // the sleigh
      ctx.fillStyle = '#c62f3b';
      ctx.beginPath();
      ctx.moveTo(x - 34, y - 12); ctx.lineTo(x + 28, y - 12); ctx.quadraticCurveTo(x + 36, y - 12, x + 34, y - 2);
      ctx.lineTo(x + 26, y + 6); ctx.lineTo(x - 30, y + 6); ctx.quadraticCurveTo(x - 40, y - 2, x - 34, y - 12); ctx.fill();
      ctx.fillStyle = '#ffce5c'; ctx.fillRect(x - 32, y - 10, 62, 3);
      ctx.strokeStyle = '#ffce5c'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x - 30, y + 14); ctx.lineTo(x + 30, y + 14); ctx.quadraticCurveTo(x + 42, y + 14, x + 40, y + 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 18, y + 6); ctx.lineTo(x - 18, y + 14); ctx.moveTo(x + 16, y + 6); ctx.lineTo(x + 16, y + 14); ctx.stroke();
    }

    // panels
    function menu() {
      state = 'menu';
      newGame(false);
      dropBtn.disabled = true;
      panel.hidden = false;
      panel.innerHTML = '<h2>🎅 Sleigh Run</h2><p>Fly over Bark Island and drop presents to the players waving below. ' +
        'Presents keep flying forward as they fall, so <b>drop early</b>. Land one right on top for a <b>PERFECT</b>, ' +
        'and keep the streak going for a combo.</p><p class="wx-keys">Space, tap or the DROP button · 60 seconds</p>' +
        '<button type="button" class="wx-go">Start</button><div class="wx-board-slot"><p class="wx-note">Loading scores…</p></div>';
      panel.querySelector('.wx-go').addEventListener('click', start);
      getBoard().then(function (b) { var s = panel.querySelector('.wx-board-slot'); if (s && state === 'menu') s.innerHTML = boardHtml(b); });
      setTimeout(function () { var b = panel.querySelector('.wx-go'); if (b) b.focus(); }, 30);
    }
    function start() {
      newGame(true);
      state = 'play';
      panel.hidden = true;
      dropBtn.disabled = false;
      dropBtn.focus();
    }
    function finish() {
      state = 'over';
      dropBtn.disabled = true;
      var score = g.score;
      panel.hidden = false;
      panel.innerHTML = '<h2>Time!</h2><p class="wx-final">' + score + '</p><p>' + g.delivered + ' delivered · best combo ' + g.best +
        ' · ' + g.missed + ' missed</p>' +
        (score > 0 ? '<form class="wx-save"><input maxlength="16" placeholder="Your name" aria-label="Your name" value="' +
          esc(store.get(NAME_KEY) || '') + '" /><button type="submit">Save score</button></form>' : '') +
        '<div class="wx-board-slot"><p class="wx-note">Loading scores…</p></div><button type="button" class="wx-go">Play again</button>';
      panel.querySelector('.wx-go').addEventListener('click', start);
      var form = panel.querySelector('.wx-save');
      var show = function (mine) {
        getBoard().then(function (b) { var s = panel.querySelector('.wx-board-slot'); if (s) s.innerHTML = boardHtml(b, mine); });
      };
      if (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var name = form.querySelector('input').value.trim().slice(0, 16);
          if (!name) { form.querySelector('input').focus(); return; }
          store.set(NAME_KEY, name);
          form.innerHTML = '<p class="wx-note">Saving…</p>';
          saveScore(name, score).then(function () { form.innerHTML = '<p class="wx-note">Saved!</p>'; show({ name: name, score: score }); });
        });
        setTimeout(function () { var i = form.querySelector('input'); if (i) i.focus(); }, 30);
      }
      show(null);
    }

    function size() {
      var d = dprOf(), w = cv.clientWidth || W;
      cv.width = Math.round(w * d); cv.height = Math.round(w * d * H / W);
      ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
    }
    function loop(now) {
      raf = requestAnimationFrame(loop);
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (document.hidden) return;
      if (cv.width !== Math.round((cv.clientWidth || W) * dprOf())) size();
      update(dt);
      draw();
    }
    function onKey(e) {
      if (!el || el.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      if (state === 'play' && (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown')) { e.preventDefault(); drop(); }
    }

    function build() {
      el = document.createElement('div');
      el.className = 'wx-game';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', 'Sleigh Run');
      el.innerHTML = '<div class="wx-game-card"><button type="button" class="wx-game-x" aria-label="Close">✕</button>' +
        '<div class="wx-game-stage"><canvas></canvas><div class="wx-game-panel"></div></div>' +
        '<div class="wx-game-bar"><button type="button" class="wx-drop" disabled>🎁 DROP</button></div></div>';
      document.body.appendChild(el);
      cv = el.querySelector('canvas'); ctx = cv.getContext('2d');
      panel = el.querySelector('.wx-game-panel');
      dropBtn = el.querySelector('.wx-drop');
      dropBtn.addEventListener('click', drop);
      cv.addEventListener('pointerdown', function (e) { e.preventDefault(); drop(); });
      el.querySelector('.wx-game-x').addEventListener('click', close);
      el.addEventListener('click', function (e) { if (e.target === el) close(); });
      document.addEventListener('keydown', onKey);
      font = getComputedStyle(document.body).fontFamily || font;
      for (var i = 0; i < 70; i++) stars.push({ x: Math.random() * W, y: Math.random() * 300, r: Math.random() < 0.2 ? 2 : 1, w: 0.5 + Math.random() * 2, p: Math.random() * 6 });
    }
    function open() {
      loadNames();
      if (!el) build();
      el.hidden = false;
      root.classList.add('wx-game-open');
      size();
      menu();
      last = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    }
    function close() {
      if (!el) return;
      el.hidden = true;
      root.classList.remove('wx-game-open');
      cancelAnimationFrame(raf); raf = 0;
      state = 'menu';
      var s = document.querySelector('.wx-star');
      if (s) s.focus();
    }
    return { open: open, close: close };
  })();

  function init() {
    snow();
    lights();
    bursts();
    star();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.BarkWinter = { play: function () { Sleigh.open(); } };
})();
