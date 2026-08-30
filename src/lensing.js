/*
 * Gravitational lensing, rendered on the GPU.
 *
 * GEOMETRY
 *
 * For a point mass M at distance D_L lensing a source at distance D_S, the
 * Einstein radius is
 *
 *     θ_E² = (4GM/c²) · D_LS / (D_L · D_S),      D_LS = D_S − D_L
 *
 * Distances are in units of a reference source distance D_S = 1, with the
 * reference lens at D_L = 0.5, where the geometric factor is exactly 1.
 * Calibrating θ_E = 20M there reproduces main.py's θ_E = mass * 20 unchanged,
 * and gives for any other geometry
 *
 *     θ_E² = (20M)² · (D_S − D_L) / (D_L · D_S)
 *
 * THE SKY HAS VOLUME
 *
 * main.py lenses one background plane. This walks the line of sight instead:
 * the sky is sampled at a sequence of depths, spaced logarithmically, and each
 * depth is deflected by its own Einstein radius before it is added. That is
 * multi-plane lensing in the limit of many planes, and it is what gives the
 * scene its depth — nearer and further material is bent by different amounts
 * at once, rather than moving as two flat sheets.
 *
 * Three consequences, all physical, all visible:
 *
 *   - More distant material is deflected more strongly.
 *   - Material in front of the lens (D_S ≤ D_L) is neither deflected nor
 *     occluded by the horizon; its light never passes the mass. Push the lens
 *     back and the volume drops out of the effect front to back.
 *   - The horizon subtends r_s / D_L, so it shrinks as the lens recedes. With
 *     r_s = 1.5M in the same length units this is 3M at the reference
 *     distance, again matching main.py.
 *
 * The sky itself is generated from a hash inside the shader rather than from a
 * texture. It is therefore unbounded — there is no edge for the deflection to
 * run off, which is what smeared the image at high mass — and it stays sharp
 * at any magnification.
 *
 * This is the flat-space form: D_LS is taken as D_S − D_L. In cosmology the
 * angular diameter distances do not subtract that way, so these distances order
 * the scene correctly without standing for real redshifts.
 *
 * The photographic backgrounds are single planes at a fixed D_S; a photograph
 * records no depth.
 */

(function () {
  'use strict';

  var SIM_SHORT_SIDE = 600.0;   /* HEIGHT in main.py */

  var MASS_MIN = 1.0;
  var MASS_MAX = 25.0;
  var MASS_INITIAL = 5.0;

  /* Lens distance D_L. Bounded away from zero: θ_E² and r_s/D_L both diverge
     as D_L → 0. The upper bound sits past the far end of the sampled volume,
     so the lens can be pushed behind everything. */
  var DIST_MIN = 0.20;
  var DIST_MAX = 4.00;
  var DIST_REFERENCE = 0.50;    /* where the geometric factor equals 1 */
  var DIST_INITIAL = DIST_REFERENCE;

  /* Depth range walked along the line of sight. */
  var DEPTH_NEAR = 0.16;
  var DEPTH_FAR  = 3.60;

  /* Depth sample count is chosen once for the device and never changed. It
     cannot serve as a quality dial: the volume is cut into 26 shells and a
     sample maps to floor(i * 26/steps), so lowering the count does not thin
     the sampling evenly — it lands on a different set of shells. Going from 18
     samples to 17 drops 8 shells and picks up 7 others, and half the sky is
     rebuilt in place. Render scale is the only safe dial, because it leaves
     the simulation coordinates untouched: simW = 600 * w / min(w, h) is
     invariant when w and h scale together, so objects keep their positions and
     only the sampling density changes. */
  var STEPS_HIGH  = 17;
  var STEPS_LOW   = 10;
  var SCALE_MIN   = 0.50;

  /* How quickly the view follows input. 1 would be instant; lower is smoother.
     Applied per frame and corrected for frame time, so the feel does not
     change with refresh rate. */
  var FOLLOW = 0.22;

  /* Left alone, the lens drifts along a closed curve. An earlier version
     wrapped around the edges, but the deflection never actually reaches zero:
     even with the lens far outside the viewport, θ_E²/θ still shifts the whole
     sky by a visible amount, so the wrap read as the page reloading. A bounded
     path has no such discontinuity. The two frequencies are incommensurable,
     so it never repeats. */
  var IDLE_MS    = 1000;
  var DRIFT_EASE = 2.2;     /* seconds to blend fully into the path */

  var VERT_SRC = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  var FRAG_SRC = `#version 300 es
precision highp float;

#define MAX_STEPS 32
#define SHELLS 26.0

// Scintillation amplitude. The two beats below sum to +/-2, so the peak
// excursion in brightness is twice this. The beats are fast enough to be
// told apart from the sky sliding under a moving lens; a slower shimmer is
// swamped by that motion and only reads once the sky is nearly still.
#define SCINT 0.03

uniform sampler2D uCat;
uniform int   uSteps;
uniform float uNear;
uniform float uFar;
uniform float uCellSize;
uniform float uFill;

uniform vec2  uSimSize;         // viewport, in simulation units
uniform vec2  uLens;            // lens centre, simulation units, y downwards
uniform float uThetaE0;         // Einstein radius at the reference geometry
uniform float uLensDist;        // D_L
uniform float uThetaS;          // angular Schwarzschild radius at this D_L
uniform float uPixelsPerUnit;
uniform float uTime;            // seconds, for scintillation only

out vec4 fragColor;

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// Reddening with distance, applied on top of an object's own colour.
vec3 distanceTint(float dS) {
  return mix(vec3(1.0, 1.0, 1.0), vec3(1.00, 0.74, 0.55),
             smoothstep(0.35, 2.6, dS));
}

// One depth slice. Objects sit on a grid whose angular cell size shrinks as
// 1/D_S, so a fixed physical size subtends a smaller angle further away and a
// more distant shell holds more objects per unit solid angle.
vec3 skySlice(vec2 ang, float dS, float id) {
  float cell = uCellSize / dS;
  vec2  p    = ang / cell;
  vec2  base = floor(p);
  vec2  f    = p - base;

  vec3 acc = vec3(0.0);

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = base + vec2(float(i), float(j));
      vec3 h = hash33(vec3(c, id));
      if (h.z > uFill) continue;

      vec2  delta = f - (vec2(float(i), float(j)) + h.xy);
      float d     = length(delta);
      // No cataloged object is wider than this in cell units, so most of the
      // 3x3 neighbourhood is rejected before touching the catalogue.
      if (d > 0.52) continue;

      // One row of the catalogue: four texels, selected by weight.
      int row = int(h.x * 255.0 + h.y * 37.0) & 255;
      vec4 t0 = texelFetch(uCat, ivec2(0, row), 0);   // core.rgb, primitive
      vec4 t1 = texelFetch(uCat, ivec2(1, row), 0);   // outer.rgb, size
      vec4 t2 = texelFetch(uCat, ivec2(2, row), 0);   // bright, aniso, spike, p1
      vec4 t3 = texelFetch(uCat, ivec2(3, row), 0);   // p2

      float prim  = t0.w;
      float size  = t1.w;
      float reach = size * 3.2 + 0.006;
      if (d > reach) continue;

      // Inclination: squash along a random axis, straight from the hash, so
      // most objects present as ellipses. No trigonometry.
      vec2  ax = normalize(h.xy * 2.0 - 1.0 + 1e-4);
      vec2  e  = vec2(dot(delta, ax), dot(delta, vec2(-ax.y, ax.x)));
      e.y /= max(0.12, 1.0 - t2.y);
      float r = length(e) / size;

      float v;

      if (prim < 0.5) {
        // POINT: a star. Tight core plus a diffraction cross.
        float core  = exp(-r * r * 2.2);
        float spike = exp(-(abs(e.x) * 26.0 + abs(e.y) * 2.6) / size)
                    + exp(-(abs(e.y) * 26.0 + abs(e.x) * 2.6) / size);
        v = core + t2.z * 0.05 * spike;
        v *= 2.1;

        // Scintillation, and it belongs in this branch alone. A source small
        // enough to be a point is covered by a single patch of disturbed
        // wavefront, so its brightness varies as that patch moves; anything
        // with angular extent is covered by many patches at once and averages
        // over them. That is the reason stars twinkle and galaxies do not.
        // Two beats of incommensurable period, phased off the object's own
        // hash, so no two stars vary together and none repeats.
        float ph = (h.x + h.y * 1.7 + id * 0.37) * 6.2831;
        v *= 1.0 + SCINT * (sin(uTime * 4.3 + ph) + sin(uTime * 6.7 + ph * 2.1));
      } else if (prim < 3.5) {
        // SPIRAL / SERSIC / SHELL: disc-like, separated by two parameters.
        float core = exp(-r * r * 2.4);
        float disc = exp(-r * 1.6);
        float shape;
        if (prim < 1.5) {
          // spiral arms: rotate the offset by an angle growing with radius
          vec2  n   = e / max(length(e), 1e-5);
          float rot = r * (1.4 + t3.x) + h.y * 6.2831;
          float cr  = cos(rot), sr = sin(rot);
          vec2  m   = vec2(n.x * cr - n.y * sr, n.x * sr + n.y * cr);
          shape = 0.62 + 0.38 * (m.x * m.x - m.y * m.y);
        } else if (prim < 2.5) {
          shape = 1.0;                                  // smooth de Vaucouleurs
        } else {
          // shell: hollow, bright rim at p2
          float rim = t3.x > 0.0 ? t3.x : 0.6;
          shape = exp(-pow((r - rim * 2.2) * 1.9, 2.0)) * 1.7;
          core *= 0.10;
        }
        v = max(core, disc * shape);
      } else {
        // CLUMPY / DIFFUSE / BILOBE / HALO
        float disc = exp(-r * 1.5);
        if (prim < 4.5) {
          float cl = 0.5 + 0.5 * sin(e.x * 31.0 / size) * sin(e.y * 27.0 / size);
          v = disc * (0.34 + 0.66 * cl);
        } else if (prim < 5.5) {
          v = exp(-r * r * 0.85) * 0.85;                 // diffuse cloud
        } else if (prim < 6.5) {
          float lobe = e.y * e.y / max(1e-5, dot(e, e)); // two lobes about ax
          v = disc * (0.14 + 0.86 * lobe);
        } else {
          v = max(exp(-r * r * 5.0), exp(-r * 1.1) * 0.42);  // core in a halo
        }
      }

      vec3 col = mix(t0.rgb, t1.rgb, smoothstep(0.10, 1.30, r));
      acc += col * v * t2.x;
    }
  }

  return acc * distanceTint(dS) / (dS * dS * 0.80 + 0.55);
}

// θ_E² for a source at dS. Zero when the source is in front of the lens, which
// leaves that material undeflected.
float einsteinSq(float dS) {
  if (dS <= uLensDist) return 0.0;
  return uThetaE0 * uThetaE0 * (dS - uLensDist) / (uLensDist * dS);
}

void main() {
  // Same frame as main.py: origin top-left, y downwards.
  vec2 frag = gl_FragCoord.xy;
  vec2 pos  = vec2(frag.x / uPixelsPerUnit,
                   uSimSize.y - frag.y / uPixelsPerUnit);

  vec2  d     = pos - uLens;
  float theta = max(length(d), 0.05);
  vec2  dir   = d / theta;
  float aa    = 1.0 / uPixelsPerUnit;

  vec3 color = vec3(0.0);

  float steps = float(uSteps);
  float ratio = uFar / uNear;

  // The volume is divided into a fixed set of shells, spaced logarithmically.
  // Sampling fewer of them skips shells; it never moves them.
  float stride = SHELLS / steps;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps) break;

    float shell = floor(float(i) * stride) + 0.5;
    float t     = shell / SHELLS;
    float dS    = uNear * pow(ratio, t);

    float tE2  = einsteinSq(dS);
    float beta = theta - tE2 / theta;
    vec2  src  = uLens + beta * dir;

    vec3 v = skySlice(src, dS, shell * 3.7);

    if (tE2 > 0.0) {
      v *= clamp(abs(theta / (beta + 0.1)), 0.5, 4.0);
    }
    if (dS > uLensDist) {
      v *= smoothstep(uThetaS - aa, uThetaS + aa, theta);
      v *= mix(0.3, 1.0, smoothstep(uThetaS * 1.5 - aa, uThetaS * 1.5 + aa, theta));
    }

    color += v;
  }

  color /= steps * 0.019;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

  function compile(gl, type, source) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  function buildProgram(gl) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT_SRC));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p));
    }
    return p;
  }

  function makeScale(min, max) {
    var span = Math.log(max / min);
    return {
      toSlider: function (v) { return Math.log(v / min) / span; },
      fromSlider: function (t) { return min * Math.exp(t * span); },
      clamp: function (v) {
        if (!isFinite(v)) return min;
        return Math.min(max, Math.max(min, v));
      }
    };
  }

  var massScale = makeScale(MASS_MIN, MASS_MAX);
  var distScale = makeScale(DIST_MIN, DIST_MAX);

  function wantsHighRes(gl) {
    if (gl.getParameter(gl.MAX_TEXTURE_SIZE) < 4096) return false;
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var shortSide = Math.min(window.screen.width, window.screen.height);
    return !(coarse && shortSide < 900);
  }

  function start() {
    var canvas   = document.getElementById('stage');
    var massIn   = document.getElementById('mass-slider');
    var massOut  = document.getElementById('mass-value');
    var distIn   = document.getElementById('dist-slider');
    var distOut  = document.getElementById('dist-value');
    var ambBtn   = document.getElementById('ambient-toggle');
    var hint     = document.getElementById('hint');
    var loading  = document.getElementById('loading');
    var failure  = document.getElementById('failure');

    var gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'high-performance'
    });

    if (!gl) { loading.hidden = true; failure.hidden = false; return; }

    var program;
    try {
      program = buildProgram(gl);
    } catch (err) {
      loading.hidden = true;
      failure.hidden = false;
      failure.textContent = 'Shader compilation failed: ' + err.message;
      return;
    }

    /* Catalogue: 4 x 256 RGBA32F, one row per weighted slot. Sampled with
       texelFetch only, so no float-filtering extension is needed. */
    var cat = window.SkyCatalogue;
    var catTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, catTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, cat.ROW_TEXELS, cat.TABLE_ROWS, 0,
                  gl.RGBA, gl.FLOAT, cat.pack());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindVertexArray(gl.createVertexArray());
    gl.useProgram(program);

    var u = {};
    ['uCat', 'uSteps', 'uNear', 'uFar', 'uCellSize', 'uFill', 'uSimSize', 'uLens',
     'uThetaE0', 'uLensDist', 'uThetaS', 'uPixelsPerUnit', 'uTime'].forEach(function (n) {
      u[n] = gl.getUniformLocation(program, n);
    });

    var highRes = wantsHighRes(gl);

    gl.uniform1i(u.uCat, 0);
    gl.uniform1f(u.uNear, DEPTH_NEAR);
    gl.uniform1f(u.uFar, DEPTH_FAR);
    gl.uniform1f(u.uCellSize, 27.0);
    gl.uniform1f(u.uFill, 0.26);
    var steps = highRes ? STEPS_HIGH : STEPS_LOW;
    gl.uniform1i(u.uSteps, steps);

    /* Live values follow target values, so input reads as motion rather than
       as jumps. */
    var st = {
      mass: MASS_INITIAL, massTarget: MASS_INITIAL,
      dist: DIST_INITIAL, distTarget: DIST_INITIAL,
      lensX: 400, lensY: 300,
      lensXTarget: 400, lensYTarget: 300,
      simW: 800, simH: 600,
      pixelsPerUnit: 1,
      lensPlaced: false,
      renderScale: 1.0,
      ambient: false
    };

    var keys = { up: false, down: false };
    var interacted = false;
    var lastTime = 0;
    var timeSec  = 0;    // wall clock, seconds, drives scintillation
    var frameAvg = 16.7;
    var tuneIn = 60;
    var warmup = 140;    // shader compile and first uploads are not typical frames
    var tuneBudget = 12; // settle, then stop adjusting; churn is worse than a
                         // slightly wrong setting
    var idleSince = 0;
    var exitHintUntil = 0;
    var drift = 0;     // 0 under manual control, eases to 1 on the path
    var handed = false;  // true once the drift owns the lens; only a click revokes it
    var driftPhase = Math.random() * 400;

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2) * st.renderScale;
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
      }
      st.pixelsPerUnit = Math.min(w, h) / SIM_SHORT_SIDE;
      st.simW = w / st.pixelsPerUnit;
      st.simH = h / st.pixelsPerUnit;
      if (!st.lensPlaced) {
        st.lensX = st.lensXTarget = st.simW / 2;
        st.lensY = st.lensYTarget = st.simH / 2;
      }
      gl.viewport(0, 0, w, h);
    }

    function toSim(cx, cy) {
      var r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: (cx - r.left) / r.width * st.simW,
               y: (cy - r.top) / r.height * st.simH };
    }

    function moveLens(cx, cy) {
      if (st.ambient) return;   // the path owns the lens in ambient mode
      if (handed) {
        // The drift owns it too, and the pointer alone does not take it back.
        if (interacted) return;
        reclaim();              // except the very first time, before anyone knows that
      }
      var p = toSim(cx, cy);
      if (!p) return;
      st.lensXTarget = p.x;
      st.lensYTarget = p.y;
      st.lensPlaced = true;
      noteInteraction();
    }

    function setMass(m) {
      st.massTarget = massScale.clamp(m);
      massIn.value = String(massScale.toSlider(st.massTarget));
      massOut.textContent = st.massTarget.toFixed(1);
    }

    function setDist(d) {
      st.distTarget = distScale.clamp(d);
      distIn.value = String(distScale.toSlider(st.distTarget));
      distOut.textContent = st.distTarget.toFixed(2);
    }

    function setAmbient(on) {
      st.ambient = on;
      document.body.classList.toggle('is-ambient', on);
      ambBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) {
        /* Pick up the path from where the lens already is, so entering the
           mode does not throw it across the screen. */
        drift = 0;
        exitHintUntil = performance.now() + 2600;
      } else {
        reclaim();
      }
    }

    /* A click, and only a click, takes the lens back from the drift. Changing
       the mass or the distance does not, and that is the point: those are worth
       doing while the lens wanders on its own, and a cursor crossing the screen
       on its way to a slider would otherwise snatch it back every time. */
    function reclaim() {
      handed = false;
      drift = 0;
      idleSince = performance.now();
    }

    function noteInteraction() {
      if (st.ambient) return;   // pointer motion must not cancel the path
      if (!handed) {
        idleSince = performance.now();
        drift = 0;
      }
      if (interacted) return;
      interacted = true;
      hint.classList.add('is-hidden');
    }

    /* Where the drift wants the lens to be at time t. Sines of two
       incommensurable frequencies, each slowly modulated, so the path stays
       inside the frame, never repeats, and never runs straight. */
    function driftPoint(t) {
      var ax = st.simW * 0.40;
      var ay = st.simH * 0.40;
      return {
        x: st.simW * 0.5 + ax * Math.sin(t * 0.1130 + 0.7) * (0.72 + 0.28 * Math.sin(t * 0.0331)),
        y: st.simH * 0.5 + ay * Math.sin(t * 0.0817 + 2.1) * (0.72 + 0.28 * Math.sin(t * 0.0264))
      };
    }




    /* ---- input --------------------------------------------------------- */

    var pointers = new Map();
    var pinchStart = null;

    canvas.addEventListener('pointerdown', function (e) {
      if (st.ambient) { setAmbient(false); return; }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (pointers.size === 2) {
        var p = Array.from(pointers.values());
        pinchStart = { dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y),
                       lensDist: st.distTarget };
      } else if (pointers.size === 1) {
        reclaim();
        moveLens(e.clientX, e.clientY);
      }
    });

    canvas.addEventListener('pointermove', function (e) {
      if (pointers.has(e.pointerId)) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (pointers.size >= 2 && pinchStart) {
        var p = Array.from(pointers.values());
        var d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        if (pinchStart.dist > 8 && d > 0) setDist(pinchStart.lensDist * (pinchStart.dist / d));
        noteInteraction();
        return;
      }
      if (e.pointerType === 'mouse' || e.pointerType === 'pen' || pointers.has(e.pointerId)) {
        moveLens(e.clientX, e.clientY);
      }
    });

    function releasePointer(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
    }
    canvas.addEventListener('pointerup', releasePointer);
    canvas.addEventListener('pointercancel', releasePointer);

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var k = Math.exp(-e.deltaY * 0.0016);   // smooth and direction-correct
      setDist(st.distTarget * k);
      noteInteraction();
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && st.ambient) { setAmbient(false); return; }
      if (e.target === massIn || e.target === distIn) return;
      if (window.scrollY > canvas.clientHeight * 0.5) return;
      if (e.key === 'ArrowUp')   { keys.up = true;   noteInteraction(); e.preventDefault(); }
      if (e.key === 'ArrowDown') { keys.down = true; noteInteraction(); e.preventDefault(); }
    });
    window.addEventListener('keyup', function (e) {
      if (e.key === 'ArrowUp') keys.up = false;
      if (e.key === 'ArrowDown') keys.down = false;
    });

    massIn.addEventListener('input', function () {
      setMass(massScale.fromSlider(parseFloat(massIn.value))); noteInteraction();
    });
    distIn.addEventListener('input', function () {
      setDist(distScale.fromSlider(parseFloat(distIn.value))); noteInteraction();
    });

    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);

    /* ---- render -------------------------------------------------------- */

    function draw() {
      gl.uniform2f(u.uSimSize, st.simW, st.simH);
      gl.uniform2f(u.uLens, st.lensX, st.lensY);
      gl.uniform1f(u.uThetaE0, 20.0 * st.mass);
      gl.uniform1f(u.uLensDist, st.dist);
      gl.uniform1f(u.uThetaS, 1.5 * st.mass / st.dist);
      gl.uniform1f(u.uPixelsPerUnit, st.pixelsPerUnit);
      gl.uniform1f(u.uTime, timeSec);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame(now) {
      var raw = lastTime ? now - lastTime : 16.7;
      var dt = Math.min(raw / 16.667, 4);
      lastTime = now;
      timeSec = now / 1000;

      /* Adaptive quality. The volume is the expensive path, so give up depth
         samples first and resolution only once those run out. Photographs are
         one texture fetch and never need it. */
      if (warmup > 0) { warmup--; lastTime = now; }

      if (warmup === 0) {
        frameAvg += (Math.min(raw, 100) - frameAvg) * 0.1;
        if (tuneBudget > 0 && --tuneIn <= 0) {
          tuneIn = 60;
          if (frameAvg > 22.0 && st.renderScale > SCALE_MIN) {
            st.renderScale = Math.max(SCALE_MIN, st.renderScale - 0.06);
            resize(); tuneBudget--;
          } else if (frameAvg < 12.5 && st.renderScale < 1) {
            st.renderScale = Math.min(1, st.renderScale + 0.06);
            resize(); tuneBudget--;
          }
        }
      }

      if (keys.up)   setMass(st.massTarget * Math.pow(1.02, dt));
      if (keys.down) setMass(st.massTarget / Math.pow(1.02, dt));

      /* Drift in ambient mode, or once the viewer has been still a while.
         The path is blended in rather than switched to, so control is handed
         over without a jump. */
      var secs = Math.min(raw, 100) / 1000;
      driftPhase += secs;
      var wantDrift = st.ambient || handed || (idleSince && now - idleSince > IDLE_MS);
      if (wantDrift) {
        if (!st.ambient) handed = true;
        drift = Math.min(1, drift + secs / DRIFT_EASE);
        var p = driftPoint(driftPhase);
        st.lensXTarget += (p.x - st.lensXTarget) * drift * Math.min(1, secs * 3.0);
        st.lensYTarget += (p.y - st.lensYTarget) * drift * Math.min(1, secs * 3.0);
        st.lensPlaced = true;
      }

      /* Frame-rate independent approach to the target. */
      var k = 1 - Math.pow(1 - FOLLOW, dt);
      st.lensX += (st.lensXTarget - st.lensX) * k;
      st.lensY += (st.lensYTarget - st.lensY) * k;
      st.mass  += (st.massTarget  - st.mass)  * k;
      st.dist  += (st.distTarget  - st.dist)  * k;

      if (exitHintUntil) {
        var show = st.ambient && now < exitHintUntil;
        document.body.classList.toggle('show-exit-hint', show);
        if (!show && !st.ambient) exitHintUntil = 0;
      }

      draw();
      requestAnimationFrame(frame);
    }

    resize();
    setMass(MASS_INITIAL);
    setDist(DIST_INITIAL);
    loading.hidden = true;
    idleSince = performance.now();
    draw();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
