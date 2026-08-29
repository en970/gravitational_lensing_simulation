/*
 * A catalogue of what the sky is made of.
 *
 * Every object drawn by the simulation is an instance of one of the types
 * listed here. The taxonomy is the real one: Morgan-Keenan classes for stars,
 * Hubble's sequence for galaxies, the usual morphological divisions for
 * nebulae and remnants. Types carry a weight, so the mix on screen reflects
 * the mix in space — M dwarfs are everywhere and O stars are rare, faint
 * dwarf galaxies outnumber giant ellipticals.
 *
 * Each type reduces to one of eight drawing primitives plus parameters, so the
 * shader stays a fixed cost regardless of how long this list grows. The list
 * is packed into a 256-row table with types repeated in proportion to their
 * weight, which turns selection into a single texture fetch.
 */

(function (global) {
  'use strict';

  /* Drawing primitives. */
  var POINT   = 0;   // a star: tight core, optional diffraction spikes
  var SPIRAL  = 1;   // exponential disc with two-armed spiral
  var SERSIC  = 2;   // de Vaucouleurs bulge, smooth
  var SHELL   = 3;   // ring or shell, bright rim, hollow centre
  var CLUMPY  = 4;   // irregular, broken into knots
  var DIFFUSE = 5;   // soft cloud, no edge
  var BILOBE  = 6;   // two lobes about an axis
  var HALO     = 7;  // dense core in an extended halo

  var entries = [];

  /* Blackbody colour, normalised to peak 1. Approximation of the Planck
     spectrum through CIE, in the form usually attributed to Tanner Helland. */
  function blackbody(kelvin) {
    var t = kelvin / 100, r, g, b;
    if (t <= 66) {
      r = 255;
      g = 99.4708025861 * Math.log(t) - 161.1195681661;
      b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    } else {
      r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
      g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
      b = 255;
    }
    var c = [r, g, b].map(function (v) { return Math.min(1, Math.max(0, v / 255)); });
    var m = Math.max(c[0], c[1], c[2]) || 1;
    return [c[0] / m, c[1] / m, c[2] / m];
  }

  function add(o) {
    entries.push({
      name:   o.name,
      cat:    o.cat,
      prim:   o.prim,
      core:   o.core,
      outer:  o.outer || o.core,
      size:   o.size,
      bright: o.bright,
      aniso:  o.aniso === undefined ? 0.55 : o.aniso,  // 0 round, 1 very flat
      spike:  o.spike || 0,
      p1:     o.p1 || 0,
      p2:     o.p2 || 0,
      weight: o.weight
    });
  }

  function star(name, kelvin, size, bright, weight, spike) {
    size *= 2.4;   // apparent size is set by the PSF, not the disc
    add({ name: name, cat: 'star', prim: POINT, core: blackbody(kelvin),
          size: size, bright: bright, aniso: 0, spike: spike === undefined ? 1 : spike,
          weight: weight });
  }

  /* ---- stars: main sequence ------------------------------------------- */
  star('O3 V main sequence',  44000, 0.020, 2.60, 0.02);
  star('O5 V main sequence',  41000, 0.019, 2.45, 0.03);
  star('O9 V main sequence',  34000, 0.017, 2.20, 0.05);
  star('B0 V main sequence',  30000, 0.016, 2.00, 0.10);
  star('B3 V main sequence',  18700, 0.014, 1.70, 0.25);
  star('B8 V main sequence',  11400, 0.013, 1.45, 0.45);
  star('A0 V main sequence',   9790, 0.012, 1.30, 0.60);
  star('A5 V main sequence',   8080, 0.011, 1.20, 0.80);
  star('F0 V main sequence',   7300, 0.011, 1.10, 1.10);
  star('F5 V main sequence',   6510, 0.010, 1.02, 1.50);
  star('G0 V main sequence',   5940, 0.010, 0.96, 1.90);
  star('G2 V main sequence',   5770, 0.010, 0.94, 2.10);
  star('G8 V main sequence',   5490, 0.009, 0.90, 2.30);
  star('K0 V main sequence',   5150, 0.009, 0.86, 3.20);
  star('K5 V main sequence',   4410, 0.009, 0.78, 4.50);
  star('M0 V red dwarf',       3840, 0.008, 0.70, 7.00);
  star('M3 V red dwarf',       3300, 0.008, 0.62, 9.00);
  star('M5 V red dwarf',       3060, 0.007, 0.55, 10.0);
  star('M8 V red dwarf',       2600, 0.007, 0.48, 8.00);

  /* ---- stars: giants, supergiants -------------------------------------- */
  star('G5 III giant',         5050, 0.016, 1.35, 0.70);
  star('K0 III giant',         4660, 0.017, 1.40, 0.90);
  star('K5 III giant',         3980, 0.019, 1.45, 0.70);
  star('M0 III giant',         3720, 0.021, 1.50, 0.55);
  star('M5 III giant',         3330, 0.024, 1.55, 0.35);
  star('B0 Ia supergiant',    21000, 0.026, 2.30, 0.05);
  star('A0 Ia supergiant',     9730, 0.026, 2.20, 0.05);
  star('F0 Ib supergiant',     7700, 0.025, 2.05, 0.06);
  star('G0 Ia supergiant',     5500, 0.027, 2.10, 0.05);
  star('K5 Ia supergiant',     3850, 0.030, 2.15, 0.04);
  star('M2 Iab red supergiant',3600, 0.034, 2.25, 0.04);

  /* ---- stars: degenerate and substellar -------------------------------- */
  star('DA white dwarf',      12000, 0.005, 0.60, 1.40);
  star('DB white dwarf',      15000, 0.005, 0.58, 0.50);
  star('DC white dwarf',       6000, 0.004, 0.45, 0.60);
  star('DQ carbon white dwarf',7500, 0.004, 0.46, 0.20);
  star('DZ metal white dwarf', 8000, 0.004, 0.46, 0.15);
  star('L2 brown dwarf',       1900, 0.005, 0.32, 1.60);
  star('L8 brown dwarf',       1400, 0.005, 0.26, 1.30);
  star('T4 brown dwarf',       1200, 0.004, 0.22, 1.10);
  star('T8 brown dwarf',        800, 0.004, 0.18, 0.80);
  star('Y1 brown dwarf',        450, 0.004, 0.14, 0.40);

  /* ---- stars: hot, evolved, peculiar ----------------------------------- */
  star('WN Wolf-Rayet',       50000, 0.018, 2.40, 0.03);
  star('WC Wolf-Rayet',       70000, 0.018, 2.45, 0.02);
  star('WO Wolf-Rayet',      150000, 0.018, 2.50, 0.01);
  star('sdB hot subdwarf',    28000, 0.007, 1.05, 0.30);
  star('sdO hot subdwarf',    45000, 0.007, 1.15, 0.15);
  star('Blue straggler',       8500, 0.010, 1.25, 0.25);
  star('Carbon star (N type)', 2800, 0.024, 1.50, 0.30);
  star('S-type star',          3100, 0.021, 1.42, 0.15);
  star('Barium star',          4800, 0.016, 1.30, 0.12);
  star('Cepheid variable',     5800, 0.024, 2.00, 0.10);
  star('RR Lyrae variable',    7000, 0.014, 1.55, 0.22);
  star('Mira variable',        2900, 0.030, 1.85, 0.28);
  star('T Tauri star',         4200, 0.012, 1.15, 0.60);
  star('FU Orionis outburst',  6200, 0.018, 1.90, 0.05);
  star('Be star with disc',   17000, 0.015, 1.75, 0.18);
  star('Luminous blue variable',15000,0.030, 2.40, 0.03);
  star('Symbiotic binary',     4000, 0.015, 1.45, 0.10);
  star('Cataclysmic variable', 9000, 0.009, 1.20, 0.14);
  star('Algol eclipsing binary',9500,0.013, 1.35, 0.20);
  star('W UMa contact binary', 5800, 0.011, 1.10, 0.24);
  star('Neutron star',       600000, 0.003, 0.90, 0.30, 0.4);
  star('Pulsar',             800000, 0.003, 1.10, 0.18, 0.6);
  star('Magnetar',           900000, 0.003, 1.25, 0.05, 0.7);
  star('X-ray binary',        30000, 0.008, 1.60, 0.10);
  star('Stellar-mass black hole', 20000, 0.004, 0.55, 0.06, 0.3);

  /* ---- supernovae: bright, transient point sources --------------------- */
  star('Type Ia supernova',   12000, 0.026, 2.70, 0.020);
  star('Type Ia-91T supernova',13000,0.026, 2.75, 0.006);
  star('Type Ia-91bg supernova',9000,0.022, 2.40, 0.006);
  star('Type Ib supernova',   11000, 0.024, 2.55, 0.010);
  star('Type Ic supernova',   11500, 0.024, 2.55, 0.010);
  star('Type Ic-BL hypernova',16000, 0.028, 2.85, 0.004);
  star('Type II-P supernova',  9000, 0.025, 2.60, 0.018);
  star('Type II-L supernova',  9500, 0.025, 2.58, 0.008);
  star('Type IIn supernova',  10500, 0.027, 2.70, 0.006);
  star('Type IIb supernova',  10000, 0.024, 2.55, 0.006);
  star('Kilonova',             6000, 0.020, 2.30, 0.003);
  star('Pair-instability supernova',14000,0.032,3.00,0.002);

  /* ---- galaxies -------------------------------------------------------- */
  function galaxy(name, prim, core, outer, size, bright, aniso, weight, p1, p2) {
    add({ name: name, cat: 'galaxy', prim: prim, core: core, outer: outer,
          size: size, bright: bright, aniso: aniso, weight: weight,
          p1: p1 || 0, p2: p2 || 0 });
  }

  var OLD  = [1.00, 0.86, 0.66];   // evolved stellar population
  var MID  = [1.00, 0.94, 0.82];
  var YNG  = [0.70, 0.83, 1.00];   // ongoing star formation
  var HOT  = [0.62, 0.78, 1.00];

  galaxy('E0 elliptical',        SERSIC, OLD, [1.00, 0.80, 0.63], 0.075, 1.05, 0.05, 0.55);
  galaxy('E2 elliptical',        SERSIC, OLD, [1.00, 0.80, 0.63], 0.075, 1.05, 0.22, 0.55);
  galaxy('E4 elliptical',        SERSIC, OLD, [1.00, 0.79, 0.62], 0.078, 1.03, 0.42, 0.45);
  galaxy('E6 elliptical',        SERSIC, OLD, [1.00, 0.79, 0.62], 0.080, 1.00, 0.62, 0.35);
  galaxy('cD supergiant elliptical', HALO, OLD, [1.00, 0.82, 0.68], 0.140, 1.25, 0.25, 0.05);
  galaxy('S0 lenticular',        SERSIC, OLD, MID,                 0.080, 1.02, 0.55, 0.50);
  galaxy('SB0 barred lenticular',SERSIC, OLD, MID,                 0.082, 1.02, 0.60, 0.30);
  galaxy('Sa spiral',            SPIRAL, OLD, [0.86, 0.88, 0.98],  0.085, 1.10, 0.45, 0.55, 2.6);
  galaxy('Sb spiral',            SPIRAL, MID, YNG,                 0.090, 1.15, 0.50, 0.75, 2.3);
  galaxy('Sc spiral',            SPIRAL, MID, YNG,                 0.095, 1.18, 0.52, 0.80, 2.0);
  galaxy('Sd spiral',            SPIRAL, MID, HOT,                 0.098, 1.12, 0.55, 0.45, 1.7);
  galaxy('SBa barred spiral',    SPIRAL, OLD, [0.86, 0.88, 0.98],  0.088, 1.10, 0.48, 0.45, 2.6);
  galaxy('SBb barred spiral',    SPIRAL, MID, YNG,                 0.092, 1.15, 0.52, 0.60, 2.3);
  galaxy('SBc barred spiral',    SPIRAL, MID, YNG,                 0.096, 1.18, 0.55, 0.55, 2.0);
  galaxy('SBd barred spiral',    SPIRAL, MID, HOT,                 0.100, 1.10, 0.58, 0.30, 1.7);
  galaxy('Irr I irregular',      CLUMPY, YNG, HOT,                 0.070, 1.00, 0.45, 0.70);
  galaxy('Irr II irregular',     CLUMPY, MID, YNG,                 0.068, 0.95, 0.50, 0.45);
  galaxy('Magellanic irregular', CLUMPY, YNG, HOT,                 0.080, 1.05, 0.55, 0.35);
  galaxy('Dwarf spheroidal',     DIFFUSE, [1.00, 0.88, 0.74], OLD, 0.040, 0.55, 0.30, 2.20);
  galaxy('Dwarf elliptical',     SERSIC, OLD, [1.00, 0.84, 0.70],  0.042, 0.62, 0.30, 1.80);
  galaxy('Dwarf irregular',      CLUMPY, YNG, HOT,                 0.038, 0.58, 0.42, 2.00);
  galaxy('Ultra-diffuse galaxy', DIFFUSE, [0.92, 0.90, 0.86], OLD, 0.110, 0.32, 0.25, 0.30);
  galaxy('Blue compact dwarf',   HALO,   HOT, YNG,                 0.032, 0.90, 0.30, 0.40);
  galaxy('Starburst galaxy',     CLUMPY, [1.00, 0.92, 0.80], HOT,  0.072, 1.35, 0.50, 0.30);
  galaxy('ULIRG merger',         CLUMPY, [1.00, 0.72, 0.52], MID,  0.078, 1.30, 0.55, 0.10);
  galaxy('Colliding pair',       CLUMPY, MID, YNG,                 0.105, 1.20, 0.60, 0.14);
  galaxy('Tidal-tail galaxy',    CLUMPY, MID, YNG,                 0.115, 1.10, 0.70, 0.10);
  galaxy('Ring galaxy',          SHELL,  MID, YNG,                 0.085, 1.10, 0.40, 0.06, 0.62);
  galaxy('Polar-ring galaxy',    SHELL,  OLD, HOT,                 0.082, 1.05, 0.55, 0.04, 0.58);
  galaxy('Jellyfish galaxy',     CLUMPY, MID, HOT,                 0.090, 1.05, 0.62, 0.05);
  galaxy('Seyfert 1',            HALO,   [1.00, 0.95, 0.88], MID,  0.070, 1.45, 0.40, 0.16);
  galaxy('Seyfert 2',            HALO,   [1.00, 0.86, 0.70], OLD,  0.070, 1.25, 0.45, 0.16);
  galaxy('LINER nucleus',        HALO,   [1.00, 0.84, 0.68], OLD,  0.068, 1.15, 0.45, 0.12);
  galaxy('FR I radio galaxy',    BILOBE, OLD, [0.72, 0.86, 1.00],  0.115, 1.20, 0.50, 0.05);
  galaxy('FR II radio galaxy',   BILOBE, OLD, [0.70, 0.84, 1.00],  0.135, 1.30, 0.45, 0.03);
  galaxy('Quasar',               HALO,   [0.96, 0.96, 1.00], HOT,  0.030, 1.90, 0.15, 0.10);
  galaxy('Blazar',               HALO,   [0.98, 0.98, 1.00], HOT,  0.024, 2.00, 0.10, 0.04);
  galaxy('BL Lac object',        HALO,   [0.95, 0.96, 1.00], HOT,  0.026, 1.80, 0.12, 0.04);
  galaxy('Lyman-break galaxy',   CLUMPY, HOT, [0.60, 0.76, 1.00],  0.034, 0.75, 0.45, 0.35);
  galaxy('Submillimetre galaxy', DIFFUSE, [1.00, 0.66, 0.46], [1.00, 0.55, 0.38], 0.040, 0.70, 0.45, 0.20);
  galaxy('High-z protogalaxy',   CLUMPY, [0.72, 0.80, 1.00], HOT,  0.028, 0.60, 0.50, 0.45);
  galaxy('Gravitational arc',    SHELL,  [0.90, 0.92, 1.00], HOT,  0.090, 0.85, 0.80, 0.05, 0.80);

  /* ---- nebulae and remnants -------------------------------------------- */
  function neb(name, prim, core, outer, size, bright, aniso, weight, p1) {
    add({ name: name, cat: 'nebula', prim: prim, core: core, outer: outer,
          size: size, bright: bright, aniso: aniso, weight: weight, p1: p1 || 0 });
  }

  var HII  = [1.00, 0.42, 0.44];   // Hα dominated
  var OIII = [0.42, 1.00, 0.80];   // doubly ionised oxygen
  var REFL = [0.58, 0.72, 1.00];   // scattered starlight
  var DUST = [0.44, 0.30, 0.24];

  neb('H II region',              DIFFUSE, HII, [1.00, 0.55, 0.42], 0.090, 0.85, 0.45, 0.55);
  neb('Giant H II complex',       CLUMPY,  HII, OIII,               0.130, 0.95, 0.50, 0.18);
  neb('Compact H II region',      DIFFUSE, HII, [1.00, 0.60, 0.45], 0.045, 0.90, 0.35, 0.30);
  neb('Reflection nebula',        DIFFUSE, REFL, [0.44, 0.58, 0.95],0.075, 0.60, 0.45, 0.40);
  neb('Cometary reflection nebula',BILOBE, REFL, [0.40, 0.55, 0.92],0.070, 0.55, 0.65, 0.10);
  neb('Dark nebula',              DIFFUSE, DUST, [0.20, 0.14, 0.12],0.100, 0.30, 0.55, 0.35);
  neb('Bok globule',              DIFFUSE, DUST, [0.16, 0.11, 0.09],0.030, 0.26, 0.35, 0.25);
  neb('Giant molecular cloud',    CLUMPY,  DUST, [0.30, 0.22, 0.18],0.160, 0.34, 0.60, 0.12);
  neb('Dust filament',            CLUMPY,  DUST, [0.26, 0.18, 0.15],0.120, 0.30, 0.85, 0.20);
  neb('Round planetary nebula',   SHELL,   OIII, [0.55, 0.90, 1.00],0.038, 1.00, 0.10, 0.22, 0.55);
  neb('Elliptical planetary nebula',SHELL, OIII, [0.60, 0.92, 1.00],0.040, 1.00, 0.45, 0.20, 0.58);
  neb('Bipolar planetary nebula', BILOBE,  OIII, HII,               0.048, 1.05, 0.60, 0.14);
  neb('Butterfly nebula',         BILOBE,  [0.70, 0.95, 1.00], HII, 0.052, 1.10, 0.70, 0.08);
  neb('Ring planetary nebula',    SHELL,   OIII, HII,               0.042, 1.05, 0.30, 0.16, 0.68);
  neb('Helix-type planetary',     SHELL,   HII, OIII,               0.055, 0.95, 0.20, 0.08, 0.60);
  neb('Shell supernova remnant',  SHELL,   [0.60, 0.85, 1.00], HII, 0.085, 0.95, 0.25, 0.16, 0.72);
  neb('Plerion (Crab-type)',      CLUMPY,  [0.70, 0.88, 1.00], HII, 0.060, 1.05, 0.45, 0.08);
  neb('Mixed-morphology remnant', DIFFUSE, [0.80, 0.72, 0.90], HII, 0.075, 0.80, 0.45, 0.10);
  neb('Cas A-type remnant',       SHELL,   [0.95, 0.70, 0.55], OIII,0.070, 1.00, 0.35, 0.06, 0.66);
  neb('Wolf-Rayet bubble',        SHELL,   OIII, [0.55, 0.85, 1.00],0.065, 0.90, 0.30, 0.05, 0.62);
  neb('Herbig-Haro object',       BILOBE,  [1.00, 0.55, 0.50], OIII,0.030, 0.85, 0.75, 0.14);
  neb('Bow shock',                SHELL,   [1.00, 0.72, 0.55], HII, 0.036, 0.75, 0.70, 0.10);
  neb('Protoplanetary disc',      SERSIC,  [1.00, 0.82, 0.62], DUST,0.022, 0.70, 0.80, 0.20);
  neb('Circumstellar shell',      SHELL,   [1.00, 0.78, 0.58], DUST,0.034, 0.60, 0.30, 0.12, 0.60);
  neb('Emission filament',        CLUMPY,  HII, OIII,               0.110, 0.55, 0.88, 0.14);

  /* ---- clusters -------------------------------------------------------- */
  function cluster(name, prim, core, outer, size, bright, aniso, weight) {
    add({ name: name, cat: 'cluster', prim: prim, core: core, outer: outer,
          size: size, bright: bright, aniso: aniso, weight: weight });
  }

  cluster('Young open cluster',   CLUMPY, HOT, [0.75, 0.85, 1.00], 0.055, 0.95, 0.35, 0.45);
  cluster('Intermediate open cluster', CLUMPY, MID, YNG,           0.050, 0.80, 0.35, 0.40);
  cluster('Old open cluster',     CLUMPY, [1.00, 0.90, 0.76], MID, 0.048, 0.70, 0.35, 0.30);
  cluster('Sparse open cluster',  CLUMPY, MID, YNG,                0.062, 0.55, 0.45, 0.28);
  cluster('Dense globular cluster', HALO, [1.00, 0.90, 0.74], OLD, 0.040, 1.15, 0.10, 0.22);
  cluster('Loose globular cluster', HALO, [1.00, 0.90, 0.76], OLD, 0.050, 0.95, 0.15, 0.18);
  cluster('Metal-rich globular',  HALO,  [1.00, 0.84, 0.66], OLD,  0.042, 1.05, 0.12, 0.12);
  cluster('Metal-poor globular',  HALO,  [1.00, 0.94, 0.82], MID,  0.044, 1.00, 0.12, 0.14);
  cluster('OB association',       CLUMPY, HOT, [0.66, 0.80, 1.00], 0.090, 0.85, 0.50, 0.20);
  cluster('T association',        CLUMPY, [1.00, 0.80, 0.66], MID, 0.080, 0.55, 0.50, 0.16);

  /* ---- packing --------------------------------------------------------- */

  var TABLE_ROWS = 256;   // selection table; types repeat by weight
  var ROW_TEXELS = 4;     // four RGBA texels per row

  /* Build a 256-entry table in which each type appears in proportion to its
     weight, so the shader selects with one fetch and no search. */
  function buildTable() {
    var total = entries.reduce(function (a, e) { return a + e.weight; }, 0);
    var rows = [];
    var acc = 0;
    entries.forEach(function (e) {
      acc += e.weight;
      var want = Math.round(acc / total * TABLE_ROWS);
      while (rows.length < want) rows.push(e);
    });
    while (rows.length < TABLE_ROWS) rows.push(entries[entries.length - 1]);
    return rows.slice(0, TABLE_ROWS);
  }

  function pack() {
    var rows = buildTable();
    var data = new Float32Array(TABLE_ROWS * ROW_TEXELS * 4);
    rows.forEach(function (e, i) {
      var o = i * ROW_TEXELS * 4;
      data[o +  0] = e.core[0];  data[o +  1] = e.core[1];
      data[o +  2] = e.core[2];  data[o +  3] = e.prim;
      data[o +  4] = e.outer[0]; data[o +  5] = e.outer[1];
      data[o +  6] = e.outer[2]; data[o +  7] = e.size;
      data[o +  8] = e.bright;   data[o +  9] = e.aniso;
      data[o + 10] = e.spike;    data[o + 11] = e.p1;
      data[o + 12] = e.p2;       data[o + 13] = 0;
      data[o + 14] = 0;          data[o + 15] = 0;
    });
    return data;
  }

  function counts() {
    var by = {};
    entries.forEach(function (e) { by[e.cat] = (by[e.cat] || 0) + 1; });
    return by;
  }

  global.SkyCatalogue = {
    entries: entries,
    TABLE_ROWS: TABLE_ROWS,
    ROW_TEXELS: ROW_TEXELS,
    pack: pack,
    counts: counts,
    names: function () { return entries.map(function (e) { return e.name; }); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
