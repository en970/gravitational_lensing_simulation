/*
 * Gravitational lensing, rendered on the GPU.
 *
 * The Python version walks every screen pixel with NumPy, computes the
 * deflection, and samples a single background plane backwards. That is a
 * per-pixel, order-independent operation, so it maps onto a fragment shader.
 * This version keeps that structure and extends it in one direction: the
 * background has depth, and the lens can be moved along the line of sight.
 *
 * GEOMETRY
 *
 * For a point mass M at distance D_L, lensing a source at distance D_S, the
 * Einstein radius is
 *
 *     θ_E² = (4GM/c²) · D_LS / (D_L · D_S),      D_LS = D_S − D_L
 *
 * Distances are in units of a reference source distance D_S = 1, and the
 * reference lens sits at D_L = 0.5, where the geometric factor
 * D_LS/(D_L·D_S) is exactly 1. Calibrating θ_E = 20M there reproduces the
 * Python version's θ_E = mass * 20 unchanged, and gives for any other geometry
 *
 *     θ_E² = (20M)² · (D_S − D_L) / (D_L · D_S)
 *
 * Three consequences, all of them physical, and all visible on screen:
 *
 *   - A more distant source is lensed more strongly. Each background plane has
 *     its own D_S, so each gets its own Einstein ring, at its own radius.
 *   - A source in front of the lens (D_S ≤ D_L) is not lensed at all, and is
 *     not occluded by the black hole either — it lies between the lens and the
 *     observer. Pushing the lens away therefore drops planes out of the effect
 *     one at a time, nearest first.
 *   - The horizon subtends a smaller angle from further away. With
 *     r_s = 1.5M in the same length units, θ_s = 1.5M / D_L, which is 3M at
 *     the reference distance, again matching the Python version.
 *
 * This is the flat-space form: D_LS is taken as D_S − D_L. In cosmology the
 * angular diameter distances do not subtract that way, so the distances here
 * order the scene correctly without standing for real redshifts.
 *
 * The photographic backgrounds are single planes, at a fixed D_S. Only the
 * procedural field has depth.
 */

(function () {
  'use strict';

  var SIM_SHORT_SIDE = 600.0;   /* HEIGHT in main.py */

  var MASS_MIN = 1.0;
  var MASS_MAX = 25.0;
  var MASS_INITIAL = 5.0;

  /* Lens distance D_L, in units of the reference source distance.
     Bounded away from zero: θ_E² and θ_s both diverge as D_L → 0. The upper
     bound sits above the most distant plane (D_S = 3.2), so the lens can be
     pushed behind every source in the scene. */
  var DIST_MIN = 0.20;
  var DIST_MAX = 3.50;
  var DIST_REFERENCE = 0.50;    /* where the geometric factor equals 1 */
  var DIST_INITIAL = DIST_REFERENCE;

  var MAX_LAYERS = 4;

  /* Source distance assigned to the photographic backgrounds. They are one
     plane, so this only sets how strongly the whole image is lensed. */
  var PHOTO_DISTANCE = 1.5;

  var BACKGROUNDS = [
    {
      id: 'procedural',
      label: 'Procedural',
      kind: 'layered'
    },
    {
      id: 'hudf',
      label: 'Ultra Deep Field',
      kind: 'photo',
      base: 'images/hudf',
      credit: 'NASA, ESA, S. Beckwith (STScI) and the HUDF Team',
      link: 'https://esahubble.org/images/heic0611b/'
    },
    {
      id: 'xdf',
      label: 'eXtreme Deep Field',
      kind: 'photo',
      base: 'images/xdf',
      credit: 'NASA, ESA, G. Illingworth, D. Magee, P. Oesch, R. Bouwens and the HUDF09 Team',
      link: 'https://esahubble.org/images/heic1214a/'
    },
    {
      id: 'abell370',
      label: 'Abell 370',
      kind: 'photo',
      base: 'images/abell370',
      credit: 'NASA, ESA/Hubble, HST Frontier Fields',
      link: 'https://esahubble.org/images/heic1711a/'
    }
  ];

  var VERT_SRC = `#version 300 es
void main() {
  // A single triangle covering the clip-space viewport.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  var FRAG_SRC = `#version 300 es
precision highp float;
precision highp sampler2DArray;

#define MAX_LAYERS 4

uniform sampler2DArray uLayers;    // procedural planes, one channel each
uniform sampler2D      uPhoto;     // photographic background, RGB

uniform int   uMode;               // 0 = layered procedural, 1 = photograph
uniform int   uLayerCount;
uniform float uLayerDist[MAX_LAYERS];
uniform float uPhotoDist;

uniform vec2  uTexSize;            // background field, in simulation units
uniform vec2  uSimSize;            // viewport, in simulation units
uniform vec2  uLens;               // lens centre, simulation units, y downwards
uniform float uThetaE0;            // Einstein radius at the reference geometry
uniform float uLensDist;           // D_L
uniform float uThetaS;             // angular Schwarzschild radius at this D_L
uniform float uPixelsPerUnit;

out vec4 fragColor;

// θ_E² for a source at dS, given the lens at uLensDist. Zero when the source
// lies in front of the lens, which leaves that plane undeflected.
float einsteinSq(float dS) {
  if (dS <= uLensDist) return 0.0;
  return uThetaE0 * uThetaE0 * (dS - uLensDist) / (uLensDist * dS);
}

vec3 samplePlane(float dS, int layer, bool photo,
                 float theta, vec2 dir, vec2 offset, float aa) {
  float tE2  = einsteinSq(dS);
  float beta = theta - tE2 / theta;
  vec2  src  = uLens + beta * dir + offset;
  vec2  uv   = src / uTexSize;

  vec3 v = photo ? texture(uPhoto, uv).rgb
                 : vec3(texture(uLayers, vec3(uv, float(layer))).r);

  // Magnification. An unlensed plane is passed through untouched.
  if (tE2 > 0.0) {
    v *= clamp(abs(theta / (beta + 0.1)), 0.5, 4.0);
  }

  // The horizon and the photon sphere only block what is behind them.
  if (dS > uLensDist) {
    v *= smoothstep(uThetaS - aa, uThetaS + aa, theta);
    v *= mix(0.3, 1.0, smoothstep(uThetaS * 1.5 - aa, uThetaS * 1.5 + aa, theta));
  }

  return v;
}

void main() {
  // Work in the same frame as main.py: origin top-left, y downwards.
  vec2 frag = gl_FragCoord.xy;
  vec2 pos  = vec2(frag.x / uPixelsPerUnit,
                   uSimSize.y - frag.y / uPixelsPerUnit);

  vec2  d     = pos - uLens;
  float theta = max(length(d), 0.1);
  vec2  dir   = d / theta;
  float aa    = 1.0 / uPixelsPerUnit;

  // The field is centred on the simulation plane, so the middle of the
  // background sits at the middle of the screen at any aspect ratio.
  vec2 offset = (uTexSize - uSimSize) * 0.5;

  vec3 color = vec3(0.0);

  if (uMode == 0) {
    // Light from the planes adds.
    for (int i = 0; i < MAX_LAYERS; i++) {
      if (i >= uLayerCount) break;
      color += samplePlane(uLayerDist[i], i, false, theta, dir, offset, aa);
    }
  } else {
    color = samplePlane(uPhotoDist, 0, true, theta, dir, offset, aa);
  }

  color = clamp(color, 0.0, 1.0);

  // The 1 px circle main.py draws at r_s, anti-aliased, at the angular size
  // the horizon has from the current lens distance.
  float ring = 1.0 - smoothstep(0.0, aa, abs(theta - uThetaS));
  color = mix(color, vec3(1.0), ring * 0.85);

  fragColor = vec4(color, 1.0);
}`;

  function compile(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  function buildProgram(gl) {
    var program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT_SRC));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    return program;
  }

  /* Both sliders are logarithmic: the mass steps multiplicatively in the
     Python version, and lens distance spans more than a decade. */
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

  /* The largest texture this device should be asked to hold. The user asked
     for the highest quality each device can carry, so this picks the full-size
     image on anything that can sample it comfortably, and the half-size one on
     phones and on GPUs with a small texture limit. */
  function wantsHighRes(gl) {
    var maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (maxTex < 4096) return false;
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var shortSide = Math.min(window.screen.width, window.screen.height);
    if (coarse && shortSide < 900) return false;
    return true;
  }

  function start() {
    var canvas   = document.getElementById('stage');
    var massIn   = document.getElementById('mass-slider');
    var massOut  = document.getElementById('mass-value');
    var distIn   = document.getElementById('dist-slider');
    var distOut  = document.getElementById('dist-value');
    var picker   = document.getElementById('picker');
    var creditEl = document.getElementById('credit');
    var hint     = document.getElementById('hint');
    var loading  = document.getElementById('loading');
    var failure  = document.getElementById('failure');
    var notice   = document.getElementById('notice');

    var gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance'
    });

    if (!gl) {
      loading.hidden = true;
      failure.hidden = false;
      return;
    }

    var program;
    try {
      program = buildProgram(gl);
    } catch (err) {
      loading.hidden = true;
      failure.hidden = false;
      failure.textContent = 'Shader compilation failed: ' + err.message;
      return;
    }

    var field = window.LensingBackground;
    var layerCount = Math.min(field.LAYER_COUNT, MAX_LAYERS);

    /* ---- textures ----------------------------------------------------- */

    var planes = field.create();

    var layerTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, layerTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8,
                  field.WIDTH, field.HEIGHT, layerCount, 0,
                  gl.RED, gl.UNSIGNED_BYTE, planes);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    planes = null;   // release the staging copy

    /* A 1x1 placeholder keeps the photo sampler bound while no photograph is
       loaded; sampling an incomplete texture is undefined behaviour. */
    var photoTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, photoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE,
                  new Uint8Array([0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.useProgram(program);

    var u = {};
    ['uLayers', 'uPhoto', 'uMode', 'uLayerCount', 'uLayerDist', 'uPhotoDist',
     'uTexSize', 'uSimSize', 'uLens', 'uThetaE0', 'uLensDist', 'uThetaS',
     'uPixelsPerUnit'].forEach(function (name) {
      u[name] = gl.getUniformLocation(program, name);
    });

    gl.uniform1i(u.uLayers, 0);
    gl.uniform1i(u.uPhoto, 1);
    gl.uniform1i(u.uLayerCount, layerCount);
    gl.uniform1fv(u.uLayerDist, field.LAYER_DISTANCE.slice(0, layerCount));
    gl.uniform1f(u.uPhotoDist, PHOTO_DISTANCE);
    gl.uniform2f(u.uTexSize, field.WIDTH, field.HEIGHT);

    /* ---- state -------------------------------------------------------- */

    var state = {
      mass: MASS_INITIAL,
      dist: DIST_INITIAL,
      lensX: 400,
      lensY: 300,
      simW: 800,
      simH: 600,
      pixelsPerUnit: 1,
      lensPlaced: false,
      mode: 0
    };

    var keys = { up: false, down: false };
    var interacted = false;
    var highRes = wantsHighRes(gl);
    var currentBackground = BACKGROUNDS[0];
    var loadToken = 0;

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      state.pixelsPerUnit = Math.min(w, h) / SIM_SHORT_SIDE;
      state.simW = w / state.pixelsPerUnit;
      state.simH = h / state.pixelsPerUnit;
      if (!state.lensPlaced) {
        state.lensX = state.simW / 2;
        state.lensY = state.simH / 2;
      }
      gl.viewport(0, 0, w, h);
    }

    function toSim(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      return {
        x: (clientX - rect.left) / rect.width * state.simW,
        y: (clientY - rect.top) / rect.height * state.simH
      };
    }

    function moveLens(clientX, clientY) {
      var p = toSim(clientX, clientY);
      if (!p) return;
      state.lensX = p.x;
      state.lensY = p.y;
      state.lensPlaced = true;
      noteInteraction();
    }

    function setMass(m) {
      state.mass = massScale.clamp(m);
      massIn.value = String(massScale.toSlider(state.mass));
      massOut.textContent = state.mass.toFixed(1);
    }

    function setDist(d) {
      state.dist = distScale.clamp(d);
      distIn.value = String(distScale.toSlider(state.dist));
      distOut.textContent = state.dist.toFixed(2);
    }

    function noteInteraction() {
      if (interacted) return;
      interacted = true;
      hint.classList.add('is-hidden');
    }

    function showNotice(text) {
      notice.textContent = text || '';
      notice.hidden = !text;
    }

    /* ---- background selection ----------------------------------------- */

    function setCredit(bg) {
      if (bg.kind !== 'photo') {
        creditEl.hidden = true;
        creditEl.innerHTML = '';
        return;
      }
      creditEl.hidden = false;
      /* CC BY 4.0 requires the credit to be visible, with a live link. */
      var a = document.createElement('a');
      a.href = bg.link;
      a.target = '_blank';
      a.rel = 'noopener';
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

    function selectBackground(bg) {
      markSelected(bg.id);

      if (bg.kind === 'layered') {
        loadToken++;                 // cancel any photograph still loading
        currentBackground = bg;
        state.mode = 0;
        setCredit(bg);
        showNotice('');
        return;
      }

      var token = ++loadToken;
      var url = bg.base + (highRes ? '-high.jpg' : '-low.jpg');
      showNotice('Loading ' + bg.label);

      var img = new Image();
      img.decoding = 'async';
      img.onload = function () {
        if (token !== loadToken) return;    // a later selection won
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, photoTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        } catch (err) {
          showNotice('Could not upload ' + bg.label + '; staying on the procedural field.');
          selectBackground(BACKGROUNDS[0]);
          return;
        }
        currentBackground = bg;
        state.mode = 1;
        setCredit(bg);
        showNotice('');
      };
      img.onerror = function () {
        if (token !== loadToken) return;
        showNotice('Could not load ' + bg.label + '; staying on the procedural field.');
        selectBackground(BACKGROUNDS[0]);
      };
      img.src = url;
    }

    BACKGROUNDS.forEach(function (bg) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = bg.id;
      b.textContent = bg.label;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        noteInteraction();
        selectBackground(bg);
      });
      picker.appendChild(b);
    });

    /* ---- input --------------------------------------------------------- */

    var pointers = new Map();
    var pinchStart = null;

    /* On desktop the lens follows the cursor with no click, as in the Python
       version. On touch it follows a single dragging finger; two fingers
       pinch the lens along the line of sight. */
    canvas.addEventListener('pointerdown', function (e) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (pointers.size === 2) {
        var pts = Array.from(pointers.values());
        pinchStart = {
          dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          lensDist: state.dist
        };
      } else if (pointers.size === 1) {
        moveLens(e.clientX, e.clientY);
      }
    });

    canvas.addEventListener('pointermove', function (e) {
      if (pointers.has(e.pointerId)) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      if (pointers.size >= 2 && pinchStart) {
        var pts = Array.from(pointers.values());
        var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        /* Spreading the fingers brings the lens closer, as a pinch-zoom does. */
        if (pinchStart.dist > 8 && d > 0) {
          setDist(pinchStart.lensDist * (pinchStart.dist / d));
        }
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

    /* Scrolling moves the lens along the line of sight. Scrolling up brings it
       closer, the direction a scroll-to-zoom gesture moves the viewpoint. */
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      setDist(e.deltaY < 0 ? state.dist / 1.08 : state.dist * 1.08);
      noteInteraction();
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      /* The sliders handle their own arrow keys, and below the fold the arrows
         belong to the page, for scrolling the text. */
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
      setMass(massScale.fromSlider(parseFloat(massIn.value)));
      noteInteraction();
    });

    distIn.addEventListener('input', function () {
      setDist(distScale.fromSlider(parseFloat(distIn.value)));
      noteInteraction();
    });

    if (window.ResizeObserver) {
      new ResizeObserver(resize).observe(canvas);
    }
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);

    /* ---- render -------------------------------------------------------- */

    function draw() {
      gl.uniform1i(u.uMode, state.mode);
      gl.uniform2f(u.uSimSize, state.simW, state.simH);
      gl.uniform2f(u.uLens, state.lensX, state.lensY);
      gl.uniform1f(u.uThetaE0, 20.0 * state.mass);
      gl.uniform1f(u.uLensDist, state.dist);
      /* r_s = 1.5 M in the same length units; its angular size is r_s / D_L,
         which is 3 M at the reference distance, as in main.py. */
      gl.uniform1f(u.uThetaS, 1.5 * state.mass / state.dist);
      gl.uniform1f(u.uPixelsPerUnit, state.pixelsPerUnit);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame() {
      /* Held arrow keys ramp the mass, as in the Python event loop. */
      if (keys.up)   setMass(state.mass * 1.02);
      if (keys.down) setMass(state.mass / 1.02);
      draw();
      requestAnimationFrame(frame);
    }

    resize();
    setMass(MASS_INITIAL);
    setDist(DIST_INITIAL);
    markSelected(BACKGROUNDS[0].id);
    setCredit(BACKGROUNDS[0]);
    loading.hidden = true;
    /* Draw the first frame synchronously, so the simulation is on screen
       before the first animation frame is scheduled. */
    draw();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
