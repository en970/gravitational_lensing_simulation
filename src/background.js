/*
 * Background field generation, in depth.
 *
 * The field is built as four planes at different source distances D_S, rather
 * than the single plane of main.py. Each plane is lensed independently, with
 * its own Einstein radius, which is what gives the scene its depth: a plane
 * further away is deflected more strongly, and a plane in front of the lens is
 * not deflected at all.
 *
 * Distances are in units of the reference source distance, D_S = 1. They are a
 * plausible ordering, not a measurement:
 *
 *   0.20  foreground   stars, nebulae and star clusters of our own galaxy
 *   0.80  near         large spiral galaxies, resolved structure
 *   1.50  mid          the central galaxy and its neighbours
 *   3.20  far          a deep field of small, faint galaxies
 *
 * Objects are scaled and dimmed with distance, so the planes read as depth even
 * before any lensing is applied.
 *
 * The galaxy, cluster and nebula shapes are those of main.py. Their positions
 * are expressed relative to the field centre rather than to a fixed 1600x1400
 * buffer, so the same field covers any viewport aspect ratio.
 */

(function (global) {
  'use strict';

  var TEX_W = 2400;
  var TEX_H = 2100;
  var CX = TEX_W / 2;
  var CY = TEX_H / 2;

  /* Source distance of each plane, in units of the reference distance D_S = 1.
     Ascending; the shader relies on nothing but the values themselves. */
  var LAYER_DISTANCE = [0.20, 0.80, 1.50, 3.20];
  var LAYER_COUNT = LAYER_DISTANCE.length;

  /* Deterministic PRNG, so the field is identical on every device and reload.
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

  function addGalaxyCluster(buf, cx, cy, radius, scale, dim) {
    var num = randInt(8, 15);
    for (var i = 0; i < num; i++) {
      var angle = rand() * 2 * Math.PI;
      var r = rand() * radius;
      addGalaxy(
        buf,
        cx + r * Math.cos(angle),
        cy + r * Math.sin(angle),
        Math.max(3, randInt(8, 20) * scale),
        randInt(60, 120) * dim
      );
    }
  }

  /* Scatter n galaxies over the whole field, avoiding the very centre so that
     the central galaxy of the mid plane stays readable. */
  function scatterGalaxies(buf, n, rMin, rMax, bMin, bMax) {
    for (var i = 0; i < n; i++) {
      var x = rand() * TEX_W;
      var y = rand() * TEX_H;
      if (Math.abs(x - CX) < 140 && Math.abs(y - CY) < 140) continue;
      addGalaxy(buf, x, y, rMin + rand() * (rMax - rMin), bMin + rand() * (bMax - bMin));
    }
  }

  function scatterStars(buf, n, sizes, bMin, bMax) {
    for (var i = 0; i < n; i++) {
      var x = randInt(0, TEX_W);
      var y = randInt(0, TEX_H);
      var brightness = randInt(bMin, bMax);
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
  }

  /* ---- plane contents -------------------------------------------------- */

  /* Plane 0, D_S = 0.20: our own galaxy. Stars, clusters and nebulae, all in
     front of the lens at its default distance, so they stay undeflected. */
  function buildForeground(buf) {
    scatterStars(buf, 2600, [1, 1, 1, 1, 2, 2, 3], 60, 255);
    addStarCluster(buf, CX - 250, CY - 100, 40, 50);
    addStarCluster(buf, CX + 250, CY + 100, 35, 45);
    addStarCluster(buf, CX - 100, CY + 150, 45, 55);
    addNebula(buf, CX + 100, CY - 100, 70);
    addNebula(buf, CX - 300, CY + 100, 60);
    addNebula(buf, CX - 600, CY - 400, 90);
    addNebula(buf, CX + 600, CY + 400, 80);
  }

  /* Plane 1, D_S = 0.80: large nearby galaxies, off to the sides. */
  function buildNear(buf) {
    addGalaxy(buf, CX - 680, CY, 65, 220);
    addGalaxy(buf, CX + 680, CY, 60, 215);
    addGalaxy(buf, CX, CY - 580, 55, 210);
    addGalaxy(buf, CX, CY + 580, 60, 215);
    scatterGalaxies(buf, 10, 20, 38, 90, 150);
  }

  /* Plane 2, D_S = 1.50: the central galaxy and its neighbours. This is the
     plane that forms the most visible Einstein ring at the default settings. */
  function buildMid(buf) {
    addGalaxy(buf, CX, CY, 110, 255);
    addGalaxy(buf, CX - 320, CY - 220, 45, 200);
    addGalaxy(buf, CX + 320, CY - 220, 40, 180);
    addGalaxy(buf, CX - 320, CY + 220, 50, 190);
    addGalaxy(buf, CX + 320, CY + 220, 45, 185);
    scatterGalaxies(buf, 26, 12, 26, 70, 130);
  }

  /* Plane 3, D_S = 3.20: a deep field. Many small, faint galaxies, the way a
     long exposure of an empty patch of sky actually looks. */
  function buildFar(buf) {
    addGalaxy(buf, CX, CY - 180, 26, 150);
    addGalaxy(buf, CX - 200, CY, 22, 140);
    addGalaxy(buf, CX + 200, CY + 50, 26, 155);
    addGalaxyCluster(buf, CX - 50, CY + 250, 80, 0.55, 0.8);
    addGalaxyCluster(buf, CX + 250, CY - 150, 70, 0.55, 0.8);
    scatterGalaxies(buf, 150, 5, 15, 45, 110);
  }

  var BUILDERS = [buildForeground, buildNear, buildMid, buildFar];

  /* Returns one Uint8Array holding the planes back to back, laid out for
     texImage3D: plane 0 first, then plane 1, and so on. */
  function create() {
    var planeSize = TEX_W * TEX_H;
    var out = new Uint8Array(planeSize * LAYER_COUNT);
    var work = new Float32Array(planeSize);

    for (var layer = 0; layer < LAYER_COUNT; layer++) {
      work.fill(0);
      BUILDERS[layer](work);
      var base = layer * planeSize;
      for (var i = 0; i < planeSize; i++) {
        var v = work[i];
        out[base + i] = v > 255 ? 255 : (v < 0 ? 0 : v);
      }
    }
    return out;
  }

  global.LensingBackground = {
    WIDTH: TEX_W,
    HEIGHT: TEX_H,
    LAYER_COUNT: LAYER_COUNT,
    LAYER_DISTANCE: LAYER_DISTANCE,
    create: create
  };
})(window);
