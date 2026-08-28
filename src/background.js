/*
 * Background field generation.
 *
 * A port of create_background_texture() in main.py. The galaxy, star-cluster
 * and nebula layout is identical; positions are expressed relative to the
 * texture centre rather than to a fixed 1600x1400 buffer, so that the same
 * field covers any viewport aspect ratio without moving the central galaxy
 * away from the centre of the screen.
 *
 * The texture is generated once, at load, and is independent of viewport size.
 */

(function (global) {
  'use strict';

  var TEX_W = 2400;
  var TEX_H = 2100;
  var CX = TEX_W / 2;
  var CY = TEX_H / 2;

  /* Deterministic PRNG, so the field is the same on every device and reload.
     Plays the role of np.random.seed(42) in the Python version. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var rand = mulberry32(42);

  function randInt(lo, hi) {
    return lo + Math.floor(rand() * (hi - lo));
  }

  function addGalaxy(buf, cx, cy, radius, maxBrightness) {
    var margin = radius * 2 + 10;
    var yMin = Math.max(0, Math.floor(cy - margin));
    var yMax = Math.min(TEX_H, Math.ceil(cy + margin));
    var xMin = Math.max(0, Math.floor(cx - margin));
    var xMax = Math.min(TEX_W, Math.ceil(cx + margin));
    if (yMax <= yMin || xMax <= xMin) return;

    var invArm = 1 / (radius * 0.4);
    var invCore = 1 / (radius * 0.12);

    for (var y = yMin; y < yMax; y++) {
      var dy = y - cy;
      var row = y * TEX_W;
      for (var x = xMin; x < xMax; x++) {
        var dx = x - cx;
        var dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
        var b = maxBrightness * Math.exp(-dist * invArm);
        var angle = Math.atan2(dy, dx);
        var spiral = 0.5 + 0.5 * Math.sin(angle * 2 + dist * 0.1);
        b = b * spiral;
        var core = maxBrightness * Math.exp(-dist * invCore);
        if (core > b) b = core;
        var i = row + x;
        if (b > buf[i]) buf[i] = b;
      }
    }
  }

  function addStarCluster(buf, cx, cy, radius, numStars) {
    for (var i = 0; i < numStars; i++) {
      var angle = rand() * 2 * Math.PI;
      var r = Math.sqrt(rand()) * radius;
      var x = Math.round(cx + r * Math.cos(angle));
      var y = Math.round(cy + r * Math.sin(angle));
      if (x < 0 || x >= TEX_W || y < 0 || y >= TEX_H) continue;
      var brightness = randInt(150, 255);
      var idx = y * TEX_W + x;
      if (brightness > buf[idx]) buf[idx] = brightness;
      if (rand() > 0.7) {
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= TEX_W || ny < 0 || ny >= TEX_H) continue;
            var j = ny * TEX_W + nx;
            var v = brightness * 0.7;
            if (v > buf[j]) buf[j] = v;
          }
        }
      }
    }
  }

  function addNebula(buf, cx, cy, radius) {
    var yMin = Math.max(0, Math.floor(cy - radius));
    var yMax = Math.min(TEX_H, Math.ceil(cy + radius));
    var xMin = Math.max(0, Math.floor(cx - radius));
    var xMax = Math.min(TEX_W, Math.ceil(cx + radius));
    if (yMax <= yMin || xMax <= xMin) return;

    var invFalloff = 1 / (radius * 0.5);

    for (var y = yMin; y < yMax; y++) {
      var dy = y - cy;
      var row = y * TEX_W;
      for (var x = xMin; x < xMax; x++) {
        var dx = x - cx;
        var dist = Math.sqrt(dx * dx + dy * dy);
        /* main.py applies the radial window to the noise only, which leaves
           the exponential term stepping to zero at the edge of the bounding
           box and draws a visible rectangle. Windowing both terms removes it. */
        var falloff = Math.max(0, 1 - dist / radius);
        var noise = rand() * 25;
        var b = (35 * Math.exp(-dist * invFalloff) + noise) * falloff;
        var i = row + x;
        if (b > buf[i]) buf[i] = b;
      }
    }
  }

  function addGalaxyCluster(buf, cx, cy, radius) {
    var num = randInt(8, 15);
    for (var i = 0; i < num; i++) {
      var angle = rand() * 2 * Math.PI;
      var r = rand() * radius;
      addGalaxy(
        buf,
        cx + r * Math.cos(angle),
        cy + r * Math.sin(angle),
        randInt(8, 20),
        randInt(60, 120)
      );
    }
  }

  /* Layout, as offsets from the texture centre. Taken directly from main.py,
     where the same objects are placed relative to a centre at (800, 700). */
  var GALAXIES = [
    [0, 0, 110, 255],        /* the main galaxy, always at screen centre */
    [-320, -220, 45, 200],
    [320, -220, 40, 180],
    [-320, 220, 50, 190],
    [320, 220, 45, 185],
    [0, -180, 35, 170],
    [-200, 0, 30, 160],
    [200, 50, 35, 175],
    [-680, 0, 65, 220],
    [680, 0, 60, 215],
    [0, -580, 55, 210],
    [0, 580, 60, 215]
  ];

  var CLUSTERS = [
    [-250, -100, 40, 50],
    [250, 100, 35, 45],
    [-100, 150, 45, 55]
  ];

  var NEBULAE = [
    [100, -100, 70],
    [-300, 100, 60],
    [-600, -400, 90],
    [600, 400, 80]
  ];

  var GALAXY_CLUSTERS = [
    [-50, 250, 80],
    [250, -150, 70]
  ];

  /* main.py scatters 2000 stars over 1600x1400. The field here is larger, so
     that it covers portrait as well as landscape viewports; the count is
     scaled to hold the surface density constant. */
  var STAR_COUNT = Math.round(2000 * (TEX_W * TEX_H) / (1600 * 1400));

  function create() {
    var buf = new Float32Array(TEX_W * TEX_H);

    for (var i = 0; i < STAR_COUNT; i++) {
      var x = randInt(0, TEX_W);
      var y = randInt(0, TEX_H);
      var brightness = randInt(60, 255);
      var sizes = [1, 1, 1, 1, 2, 2, 3];
      var size = sizes[randInt(0, sizes.length)];
      for (var dy = -size; dy <= size; dy++) {
        for (var dx = -size; dx <= size; dx++) {
          var nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= TEX_W || ny < 0 || ny >= TEX_H) continue;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > size) continue;
          var b = brightness * (1 - dist / (size + 1));
          var idx = ny * TEX_W + nx;
          if (b > buf[idx]) buf[idx] = b;
        }
      }
    }

    var k;
    for (k = 0; k < GALAXIES.length; k++) {
      addGalaxy(buf, CX + GALAXIES[k][0], CY + GALAXIES[k][1], GALAXIES[k][2], GALAXIES[k][3]);
    }
    for (k = 0; k < CLUSTERS.length; k++) {
      addStarCluster(buf, CX + CLUSTERS[k][0], CY + CLUSTERS[k][1], CLUSTERS[k][2], CLUSTERS[k][3]);
    }
    for (k = 0; k < NEBULAE.length; k++) {
      addNebula(buf, CX + NEBULAE[k][0], CY + NEBULAE[k][1], NEBULAE[k][2]);
    }
    for (k = 0; k < GALAXY_CLUSTERS.length; k++) {
      addGalaxyCluster(buf, CX + GALAXY_CLUSTERS[k][0], CY + GALAXY_CLUSTERS[k][1], GALAXY_CLUSTERS[k][2]);
    }

    var out = new Uint8Array(TEX_W * TEX_H);
    for (var j = 0; j < buf.length; j++) {
      var v = buf[j];
      out[j] = v > 255 ? 255 : (v < 0 ? 0 : v);
    }
    return out;
  }

  global.LensingBackground = { WIDTH: TEX_W, HEIGHT: TEX_H, create: create };
})(window);
