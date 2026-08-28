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

  var STEPS_MAX   = 26;
  var STEPS_MIN   = 8;
  var STEPS_START_HIGH = 16;
  var STEPS_START_LOW  = 11;
  var SCALE_MIN   = 0.55;

  var PHOTO_DISTANCE = 1.5;

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
  var IDLE_MS    = 3500;
  var DRIFT_EASE = 2.2;     /* seconds to blend fully into the path */

  var BACKGROUNDS = [
    { id: 'procedural', label: 'Procedural', kind: 'volume' },
    { id: 'hudf',  label: 'Ultra Deep Field', kind: 'photo', base: 'images/hudf',
      credit: 'NASA, ESA, S. Beckwith (STScI) and the HUDF Team',
      link: 'https://esahubble.org/images/heic0611b/' },
    { id: 'xdf',   label: 'eXtreme Deep Field', kind: 'photo', base: 'images/xdf',
      credit: 'NASA, ESA, G. Illingworth, D. Magee, P. Oesch, R. Bouwens and the HUDF09 Team',
      link: 'https://esahubble.org/images/heic1214a/' },
    { id: 'abell370', label: 'Abell 370', kind: 'photo', base: 'images/abell370',
      credit: 'NASA, ESA/Hubble, HST Frontier Fields',
      link: 'https://esahubble.org/images/heic1711a/' }
  ];

  var VERT_SRC = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  var FRAG_SRC = `#version 300 es
precision highp float;

#define MAX_STEPS 32
#define SHELLS 26.0

uniform sampler2D uPhoto;

uniform int   uMode;            // 0 = procedural volume, 1 = photograph
uniform int   uSteps;
uniform float uNear;
uniform float uFar;
uniform float uCellSize;
uniform float uFill;

uniform vec2  uPhotoField;      // photograph extent, in simulation units
uniform float uPhotoDist;

uniform vec2  uSimSize;         // viewport, in simulation units
uniform vec2  uLens;            // lens centre, simulation units, y downwards
uniform float uThetaE0;         // Einstein radius at the reference geometry
uniform float uLensDist;        // D_L
uniform float uThetaS;          // angular Schwarzschild radius at this D_L
uniform float uPixelsPerUnit;

out vec4 fragColor;

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// Nearby stars run blue-white; distant galaxies redden. The real trend, and a
// strong depth cue.
vec3 tintFor(float dS, float which) {
  vec3 nearC = vec3(0.82, 0.88, 1.00);
  vec3 midC  = vec3(1.00, 0.98, 0.94);
  vec3 farC  = vec3(1.00, 0.78, 0.58);
  float t = clamp((dS - 0.30) / 2.20, 0.0, 1.0);
  vec3 c = mix(nearC, midC, smoothstep(0.0, 0.45, t));
  c = mix(c, farC, smoothstep(0.35, 1.0, t));
  return c * (0.85 + 0.30 * which);
}

// One depth slice of the sky. Objects sit on a grid whose angular cell size
// shrinks as 1/D_S, so a fixed physical size subtends a smaller angle further
// away and a more distant shell holds more objects per unit solid angle.
vec3 skySlice(vec2 ang, float dS, float id) {
  float cell = uCellSize / dS;
  vec2  p    = ang / cell;
  vec2  base = floor(p);
  vec2  f    = p - base;

  float starry = 1.0 - smoothstep(0.28, 0.46, dS);
  vec3  acc    = vec3(0.0);

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = base + vec2(float(i), float(j));
      vec3 h = hash33(vec3(c, id));
      if (h.z > uFill) continue;

      vec3  h2    = hash33(vec3(c.yx, id + 17.0));
      vec2  delta = f - (vec2(float(i), float(j)) + h.xy);
      float d     = length(delta);
      if (d > 1.4) continue;

      // Most things are faint; a few are bright. A plain uniform draw made
      // every galaxy equally prominent, which is what read as artificial.
      float bright = 0.16 + 0.84 * pow(h2.x, 1.6);
      float v;
      vec3  col;

      if (h2.z < starry) {
        // A star. Colour by temperature rather than painting them all white.
        float temp  = h.x;
        vec3  hot   = vec3(0.74, 0.83, 1.00);
        vec3  sun   = vec3(1.00, 0.96, 0.88);
        vec3  cool  = vec3(1.00, 0.78, 0.60);
        col = mix(mix(hot, sun, smoothstep(0.0, 0.55, temp)),
                  cool, smoothstep(0.55, 1.0, temp));
        float core  = exp(-d * d * 4200.0);
        float spike = exp(-(abs(delta.x) * 260.0 + abs(delta.y) * 22.0))
                    + exp(-(abs(delta.y) * 260.0 + abs(delta.x) * 22.0));
        v = (core + 0.06 * spike) * 2.3;
      } else {
        float scale = 0.040 + 0.070 * h2.x;

        // Inclination: squash along a random axis, so most galaxies present as
        // ellipses rather than face-on discs. Built from the hash directly, so
        // it costs no trigonometry.
        vec2  ax   = normalize(h.xy * 2.0 - 1.0 + 1e-4);
        vec2  e    = vec2(dot(delta, ax), dot(delta, vec2(-ax.y, ax.x)));
        float incl = 0.22 + 0.78 * h2.y;          // axis ratio
        e.y /= incl;
        float r = length(e) / scale;

        vec3 coreC = vec3(1.00, 0.87, 0.68);      // old stars, yellow-red
        vec3 outerC;

        float core = exp(-r * r * 2.6);
        float disc = exp(-r * 1.6);
        float typ  = fract(h2.z * 3.137);

        if (typ < 0.42) {
          // Elliptical: smooth, no arms, red throughout.
          outerC = vec3(1.00, 0.80, 0.63);
          v = max(core, disc * 0.85);
        } else if (typ < 0.88) {
          // Spiral: yellow core, blue arms.
          outerC = vec3(0.70, 0.83, 1.00);
          vec2  n2  = e / max(length(e), 1e-5);
          float rot = r * 2.3 + h2.y * 6.2831;
          float cr  = cos(rot), sr = sin(rot);
          vec2  m   = vec2(n2.x * cr - n2.y * sr, n2.x * sr + n2.y * cr);
          float arms = 0.30 + 0.70 * (m.x * m.x - m.y * m.y) * 0.5 + 0.35;
          v = max(core, disc * arms);
        } else {
          // Irregular: clumpy and blue, the way small starbursts look.
          outerC = vec3(0.66, 0.86, 1.00);
          float cl = 0.5 + 0.5 * sin(e.x * 34.0 / scale) * sin(e.y * 29.0 / scale);
          v = disc * (0.35 + 0.65 * cl);
        }

        col = mix(coreC, outerC, smoothstep(0.10, 1.30, r));
        v *= 1.35;
      }

      // Reddening with distance rides on top of the object's own colour.
      acc += col * tintFor(dS, h2.y) * v * bright;
    }
  }

  return acc / (dS * dS * 0.80 + 0.55);
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

  if (uMode == 0) {
    float steps = float(uSteps);
    float ratio = uFar / uNear;

    // The volume is divided into a fixed set of shells, spaced logarithmically.
    // Sampling fewer of them skips shells; it never moves them. Depth and hash
    // identity therefore depend on the shell, not on the sample count, so
    // changing quality does not rebuild the sky underneath the viewer.
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
      // The horizon and photon sphere only block what lies behind them.
      if (dS > uLensDist) {
        v *= smoothstep(uThetaS - aa, uThetaS + aa, theta);
        v *= mix(0.3, 1.0, smoothstep(uThetaS * 1.5 - aa, uThetaS * 1.5 + aa, theta));
      }

      color += v;
    }

    color /= steps * 0.034;
  } else {
    float tE2  = einsteinSq(uPhotoDist);
    float beta = theta - tE2 / theta;
    vec2  src  = uLens + beta * dir;

    // The photograph is centred on the viewport and keeps its own aspect
    // ratio; outside it there is nothing rather than a smeared edge.
    vec2 uv = (src - uSimSize * 0.5) / uPhotoField + 0.5;
    if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
      color = texture(uPhoto, uv).rgb;
      if (tE2 > 0.0) {
        color *= clamp(abs(theta / (beta + 0.1)), 0.5, 4.0);
      }
    }
    if (uPhotoDist > uLensDist) {
      color *= smoothstep(uThetaS - aa, uThetaS + aa, theta);
      color *= mix(0.3, 1.0, smoothstep(uThetaS * 1.5 - aa, uThetaS * 1.5 + aa, theta));
    }
  }

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
    var picker   = document.getElementById('picker');
    var fitBtn   = document.getElementById('fit-toggle');
    var ambBtn   = document.getElementById('ambient-toggle');
    var creditEl = document.getElementById('credit');
    var hint     = document.getElementById('hint');
    var loading  = document.getElementById('loading');
    var failure  = document.getElementById('failure');
    var notice   = document.getElementById('notice');

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

    var photoTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, photoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE,
                  new Uint8Array([0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindVertexArray(gl.createVertexArray());
    gl.useProgram(program);

    var u = {};
    ['uPhoto', 'uMode', 'uSteps', 'uNear', 'uFar', 'uCellSize', 'uFill',
     'uPhotoField', 'uPhotoDist', 'uSimSize', 'uLens', 'uThetaE0', 'uLensDist',
     'uThetaS', 'uPixelsPerUnit'].forEach(function (n) {
      u[n] = gl.getUniformLocation(program, n);
    });

    var highRes = wantsHighRes(gl);

    gl.uniform1i(u.uPhoto, 0);
    gl.uniform1f(u.uNear, DEPTH_NEAR);
    gl.uniform1f(u.uFar, DEPTH_FAR);
    gl.uniform1f(u.uCellSize, 38.0);
    gl.uniform1f(u.uFill, 0.13);
    var steps = highRes ? STEPS_START_HIGH : STEPS_START_LOW;
    gl.uniform1i(u.uSteps, steps);
    gl.uniform1f(u.uPhotoDist, PHOTO_DISTANCE);

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
      mode: 0,
      photoAspect: 1,
      fit: false,
      renderScale: 1.0,
      ambient: false
    };

    var keys = { up: false, down: false };
    var interacted = false;
    var loadToken = 0;
    var lastTime = 0;
    var frameAvg = 16.7;
    var tuneIn = 60;
    var warmup = 140;    // shader compile and first uploads are not typical frames
    var tuneBudget = 12; // settle, then stop adjusting; churn is worse than a
                         // slightly wrong setting
    var idleSince = 0;
    var exitHintUntil = 0;
    var drift = 0;     // 0 under manual control, eases to 1 on the path
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

    /* Photograph extent in simulation units. "Fit" shows the whole image,
       letterboxed; "Fill" covers the viewport and crops the long edge. */
    function photoField() {
      var a = st.photoAspect;
      var s = st.fit ? Math.min(st.simW / a, st.simH)
                     : Math.max(st.simW / a, st.simH);
      return [s * a, s];
    }

    function toSim(cx, cy) {
      var r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: (cx - r.left) / r.width * st.simW,
               y: (cy - r.top) / r.height * st.simH };
    }

    function moveLens(cx, cy) {
      if (st.ambient) return;   // the path owns the lens in ambient mode
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
        drift = 0;
        idleSince = performance.now();
      }
    }

    function noteInteraction() {
      if (st.ambient) return;   // pointer motion must not cancel the path
      idleSince = performance.now();
      drift = 0;
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

    function showNotice(t) { notice.textContent = t || ''; notice.hidden = !t; }

    function setCredit(bg) {
      if (bg.kind !== 'photo') { creditEl.hidden = true; creditEl.innerHTML = ''; return; }
      creditEl.hidden = false;
      var a = document.createElement('a');
      a.href = bg.link; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = bg.credit;
      creditEl.innerHTML = '';
      creditEl.appendChild(document.createTextNode('Image: '));
      creditEl.appendChild(a);
      creditEl.appendChild(document.createTextNode(' · CC BY 4.0'));
    }

    function markSelected(id) {
      Array.prototype.forEach.call(picker.querySelectorAll('button'), function (b) {
        var on = b.dataset.id === id;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    function updateFitButton() {
      fitBtn.textContent = st.fit ? 'Fit' : 'Fill';
      fitBtn.setAttribute('aria-pressed', st.fit ? 'true' : 'false');
      fitBtn.hidden = st.mode !== 1;
    }

    /* Photographs load in two stages. A small preview arrives almost at once
       and is shown immediately; the full-resolution file follows and replaces
       it. Both requests start together, and a late preview never overwrites a
       full image that already landed. */
    function uploadImage(img) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, photoTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      st.photoAspect = img.naturalWidth / img.naturalHeight;
    }

    function selectBackground(bg) {
      markSelected(bg.id);

      if (bg.kind === 'volume') {
        loadToken++;
        st.mode = 0;
        setCredit(bg);
        showNotice('');
        updateFitButton();
        return;
      }

      var token = ++loadToken;
      var applied = 0;              // 0 nothing, 1 preview, 2 full
      var failures = 0;
      showNotice('Loading ' + bg.label);

      function stage(url, rank, isFull) {
        var img = new Image();
        img.decoding = 'async';
        img.onload = function () {
          if (token !== loadToken || rank <= applied) return;
          try {
            uploadImage(img);
          } catch (err) {
            showNotice('Could not upload ' + bg.label + '.');
            selectBackground(BACKGROUNDS[0]);
            return;
          }
          applied = rank;
          st.mode = 1;
          setCredit(bg);
          updateFitButton();
          showNotice(isFull ? '' : 'Sharpening ' + bg.label);
        };
        img.onerror = function () {
          if (token !== loadToken) return;
          failures++;
          /* One tier failing is survivable as long as the other lands. */
          if (failures >= 2 && applied === 0) {
            showNotice('Could not load ' + bg.label + '.');
            selectBackground(BACKGROUNDS[0]);
          }
        };
        img.src = url;
      }

      stage(bg.base + '-preview.jpg', 1, false);
      stage(bg.base + (highRes ? '-high.jpg' : '-low.jpg'), 2, true);
    }

    BACKGROUNDS.forEach(function (bg) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = bg.id;
      b.textContent = bg.label;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { noteInteraction(); selectBackground(bg); });
      picker.appendChild(b);
    });

    fitBtn.addEventListener('click', function () {
      st.fit = !st.fit;
      updateFitButton();
      noteInteraction();
    });

    ambBtn.addEventListener('click', function () { setAmbient(!st.ambient); });

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
      var f = photoField();
      gl.uniform1i(u.uMode, st.mode);
      gl.uniform2f(u.uPhotoField, f[0], f[1]);
      gl.uniform2f(u.uSimSize, st.simW, st.simH);
      gl.uniform2f(u.uLens, st.lensX, st.lensY);
      gl.uniform1f(u.uThetaE0, 20.0 * st.mass);
      gl.uniform1f(u.uLensDist, st.dist);
      gl.uniform1f(u.uThetaS, 1.5 * st.mass / st.dist);
      gl.uniform1f(u.uPixelsPerUnit, st.pixelsPerUnit);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame(now) {
      var raw = lastTime ? now - lastTime : 16.7;
      var dt = Math.min(raw / 16.667, 4);
      lastTime = now;

      /* Adaptive quality. The volume is the expensive path, so give up depth
         samples first and resolution only once those run out. Photographs are
         one texture fetch and never need it. */
      if (warmup > 0) { warmup--; lastTime = now; }

      if (st.mode === 0 && warmup === 0) {
        frameAvg += (Math.min(raw, 100) - frameAvg) * 0.1;
        if (tuneBudget > 0 && --tuneIn <= 0) {
          tuneIn = 60;
          if (frameAvg > 22.0) {
            if (steps > STEPS_MIN) { steps--; gl.uniform1i(u.uSteps, steps); tuneBudget--; }
            else if (st.renderScale > SCALE_MIN) {
              st.renderScale = Math.max(SCALE_MIN, st.renderScale - 0.05);
              resize(); tuneBudget--;
            }
          } else if (frameAvg < 12.5) {
            if (st.renderScale < 1) {
              st.renderScale = Math.min(1, st.renderScale + 0.05);
              resize(); tuneBudget--;
            } else if (steps < (highRes ? STEPS_MAX : STEPS_START_LOW + 3)) {
              steps++; gl.uniform1i(u.uSteps, steps); tuneBudget--;
            }
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
      var wantDrift = st.ambient || (idleSince && now - idleSince > IDLE_MS);
      if (wantDrift) {
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
    markSelected(BACKGROUNDS[0].id);
    setCredit(BACKGROUNDS[0]);
    updateFitButton();
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
