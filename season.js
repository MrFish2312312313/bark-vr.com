/* ============================
   BARKVR — season.js
   The site dresses itself for the time of year, every year, on its own: each page loads this in its <head> and it adds
   the season's stylesheet (seasons/<name>.css) layered over style.css. Out of every season = the normal look.

   ADD A SEASON: a row below ({ name, from: [month, day], to: [month, day], color } - a window may wrap over New Year)
   and a seasons/<name>.css. Earlier rows win where windows overlap.
   COLOR = the page's theme-color: the browser's bar on phones AND the coloured edge of a link's preview in Discord.
   Discord never runs this file, so Bark Manager writes the season's colour into every page's
   <meta name="theme-color"> when the season changes (it reads the rows below - keep each row on one line).
   PREVIEW ONE: ?theme=winter, ?theme=halloween ... or ?theme=none on any page.
   ============================ */
(function () {
  var SEASONS = [
    { name: 'halloween', from: [10, 1], to: [11, 2], color: '#ff7a1a' },   // spooky October, through the day after Halloween
    { name: 'winter',    from: [11, 3], to: [1, 15], color: '#e63946' },   // snow from November until the middle of January
  ];
  var NORMAL_COLOR = '#00e5ff';
  var VERSION = 1;

  function inside(s, now) {
    var m = now.getMonth() + 1, d = now.getDate();
    var v = m * 100 + d, a = s.from[0] * 100 + s.from[1], b = s.to[0] * 100 + s.to[1];
    return a <= b ? (v >= a && v <= b) : (v >= a || v <= b);   // (a window over New Year wraps)
  }

  var name = '', color = NORMAL_COLOR;
  try {
    var asked = new URLSearchParams(location.search).get('theme');
    if (asked) name = asked === 'none' ? '' : asked.replace(/[^a-z0-9-]/gi, '');
    else {
      var now = new Date();
      for (var i = 0; i < SEASONS.length; i++) if (inside(SEASONS[i], now)) { name = SEASONS[i].name; break; }
    }
    for (var j = 0; j < SEASONS.length; j++) if (SEASONS[j].name === name) color = SEASONS[j].color;
  } catch (e) { name = ''; }

  document.documentElement.setAttribute('data-season', name || 'none');
  // written while the head is still being read, so the page never shows undressed first 🍍
  if (name) document.write('<link rel="stylesheet" href="seasons/' + name + '.css?v=' + VERSION + '" />');

  // the browser's bar follows the season even if a page's saved theme-color is behind
  function tint() {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    if (!metas.length) { var m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); metas = [m]; }
    for (var k = 0; k < metas.length; k++) metas[k].setAttribute('content', color);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tint); else tint();
})();
