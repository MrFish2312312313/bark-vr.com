/* ============================
   BARKVR — season.js
   The site dresses itself for the time of year, every year, on its own: each page loads this in its <head> and it adds
   the season's stylesheet (seasons/<name>.css) layered over style.css. Out of every season = the normal look.

   ADD A SEASON: a row below ({ name, from: [month, day], to: [month, day] } - a window may wrap over New Year) and a
   seasons/<name>.css. Earlier rows win where windows overlap.
   PREVIEW ONE: ?theme=winter, ?theme=halloween ... or ?theme=none on any page.
   ============================ */
(function () {
  var SEASONS = [
    { name: 'halloween', from: [10, 1], to: [11, 2] },   // spooky October, through the day after Halloween
    { name: 'winter',    from: [11, 3], to: [1, 15] },   // snow from November until the middle of January
  ];
  var VERSION = 1;

  function inside(s, now) {
    var m = now.getMonth() + 1, d = now.getDate();
    var v = m * 100 + d, a = s.from[0] * 100 + s.from[1], b = s.to[0] * 100 + s.to[1];
    return a <= b ? (v >= a && v <= b) : (v >= a || v <= b);   // (a window over New Year wraps)
  }

  var name = '';
  try {
    var asked = new URLSearchParams(location.search).get('theme');
    if (asked) name = asked === 'none' ? '' : asked.replace(/[^a-z0-9-]/gi, '');
    else {
      var now = new Date();
      for (var i = 0; i < SEASONS.length; i++) if (inside(SEASONS[i], now)) { name = SEASONS[i].name; break; }
    }
  } catch (e) { name = ''; }

  document.documentElement.setAttribute('data-season', name || 'none');
  // written while the head is still being read, so the page never shows undressed first 🍍
  if (name) document.write('<link rel="stylesheet" href="seasons/' + name + '.css?v=' + VERSION + '" />');
})();
