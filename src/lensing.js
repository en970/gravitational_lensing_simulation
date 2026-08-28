/*
 * Gravitational lensing, rendered on the GPU.
 *
 * The Python version walks every screen pixel with NumPy, computes the
 * deflection, and samples the background texture backwards. That is a
 * per-pixel, order-independent operation, so it maps directly onto a fragment
 * shader. The equations below are the ones in render_lensed_view() in main.py,
 * unchanged:
 *
 *     theta_E     = mass * 20            Einstein radius, in simulation units
 *     r_s         = mass * 3             Schwarzschild radius
 *     deflection  = theta_E^2 / theta    thin-lens approximation
 *     beta        = theta - deflection   source-plane position
 *     mu          = |theta / beta|       magnification, clamped to [0.5, 4]
 *
 * The shorter side of the viewport is 600 simulation units, matching HEIGHT in
 * main.py, so that on a landscape display a given mass produces an Einstein
 * ring of the same relative size as it does in the Python version. The longer
 * side follows the aspect ratio, which keeps the ring a sensible fraction of
 * the screen in portrait as well.
 */

(function () {
  'use strict';

  var SIM_SHORT_SIDE = 600.0;   /* HEIGHT in main.py */
  var MASS_MIN = 1.0;
  var MASS_MAX = 25.0;
  var MASS_INITIAL = 5.0;

  var VERT_SRC = `#version 300 es
void main() {
  // A single triangle covering the clip-space viewport.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  var FRAG_SRC = `#version 300 es
precision highp float;

uniform sampler2D uBackground;
uniform vec2  uTexSize;       // background texture, in texels
uniform vec2  uSimSize;       // viewport, in simulation units
uniform vec2  uLens;          // lens centre, in simulation units, y downwards
uniform float uMass;
uniform float uPixelsPerUnit; // device pixels per simulation unit

out vec4 fragColor;

void main() {
  // Work in the same coordinate frame as main.py: origin top-left, y downwards.
  vec2 frag = gl_FragCoord.xy;
  vec2 pos  = vec2(frag.x / uPixelsPerUnit,
                   uSimSize.y - frag.y / uPixelsPerUnit);

  vec2  d     = pos - uLens;
  float theta = max(length(d), 0.1);

  float thetaE = uMass * 20.0;
  float rs     = uMass * 3.0;

  float deflection = (thetaE * thetaE) / theta;
  float betaMag    = theta - deflection;
  vec2  dir        = d / theta;

  // The texture is centred on the simulation plane, so the central galaxy sits
  // at the centre of the screen whatever the aspect ratio.
  vec2 offset = (uTexSize - uSimSize) * 0.5;
  vec2 src    = uLens + betaMag * dir + offset;

  float value = texture(uBackground, src / uTexSize).r;

  float magnif = clamp(abs(theta / (betaMag + 0.1)), 0.5, 4.0);
  value *= magnif;

  // Event horizon and photon sphere.
  float aa = 1.0 / uPixelsPerUnit;
  value *= mix(0.3, 1.0, smoothstep(rs * 1.5 - aa, rs * 1.5 + aa, theta));
  value *= smoothstep(rs - aa, rs + aa, theta);

  value = clamp(value, 0.0, 1.0);
  vec3 color = vec3(value);

  // The 1 px circle drawn at r_s in the Python version, anti-aliased here.
  float ring = 1.0 - smoothstep(0.0, aa, abs(theta - rs));
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

  /* Mass maps onto the slider logarithmically, matching the multiplicative
     steps the Python version applies to the scroll wheel and arrow keys. */
  function massToSlider(mass) {
    return Math.log(mass / MASS_MIN) / Math.log(MASS_MAX / MASS_MIN);
  }

  function sliderToMass(t) {
    return MASS_MIN * Math.pow(MASS_MAX / MASS_MIN, t);
  }

  function clampMass(m) {
    return Math.min(MASS_MAX, Math.max(MASS_MIN, m));
  }

  function start() {
    var canvas = document.getElementById('stage');
    var slider = document.getElementById('mass-slider');
    var readout = document.getElementById('mass-value');
    var hint = document.getElementById('hint');
    var loading = document.getElementById('loading');
    var failure = document.getElementById('failure');

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

    var pixels = window.LensingBackground.create();
    var texW = window.LensingBackground.WIDTH;
    var texH = window.LensingBackground.HEIGHT;

    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, texW, texH, 0, gl.RED, gl.UNSIGNED_BYTE, pixels);
    /* Bilinear sampling; the Python version takes the nearest texel, which
       breaks up under magnification. */
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    gl.useProgram(program);
    var uBackground   = gl.getUniformLocation(program, 'uBackground');
    var uTexSize      = gl.getUniformLocation(program, 'uTexSize');
    var uSimSize      = gl.getUniformLocation(program, 'uSimSize');
    var uLens         = gl.getUniformLocation(program, 'uLens');
    var uMass         = gl.getUniformLocation(program, 'uMass');
    var uPixelsPerUnit = gl.getUniformLocation(program, 'uPixelsPerUnit');

    gl.uniform1i(uBackground, 0);
    gl.uniform2f(uTexSize, texW, texH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    var state = {
      mass: MASS_INITIAL,
      lensX: 400,
      lensY: 300,
      simW: 800,
      simH: 600,
      pixelsPerUnit: 1,
      lensPlaced: false
    };

    var keys = { up: false, down: false };
    var interacted = false;

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
      return {
        x: (clientX - rect.left) / rect.width * state.simW,
        y: (clientY - rect.top) / rect.height * state.simH
      };
    }

    function moveLens(clientX, clientY) {
      var p = toSim(clientX, clientY);
      state.lensX = p.x;
      state.lensY = p.y;
      state.lensPlaced = true;
      noteInteraction();
    }

    function setMass(m) {
      state.mass = clampMass(m);
      slider.value = String(massToSlider(state.mass));
      readout.textContent = state.mass.toFixed(1);
    }

    function noteInteraction() {
      if (interacted) return;
      interacted = true;
      hint.classList.add('is-hidden');
    }

    var pointers = new Map();
    var pinchStart = null;

    /* On desktop the lens follows the cursor with no click, as in the Python
       version. On touch it follows a single dragging finger; two fingers
       pinch the mass instead. */
    canvas.addEventListener('pointerdown', function (e) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      if (pointers.size === 2) {
        var pts = Array.from(pointers.values());
        pinchStart = {
          dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          mass: state.mass
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
        var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchStart.dist > 0) setMass(pinchStart.mass * (dist / pinchStart.dist));
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
      setMass(e.deltaY < 0 ? state.mass * 1.1 : state.mass / 1.1);
      noteInteraction();
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      /* The slider handles its own arrow keys, and below the fold the arrows
         belong to the page, for scrolling the text. */
      if (e.target === slider) return;
      if (window.scrollY > canvas.clientHeight * 0.5) return;
      if (e.key === 'ArrowUp') { keys.up = true; noteInteraction(); e.preventDefault(); }
      if (e.key === 'ArrowDown') { keys.down = true; noteInteraction(); e.preventDefault(); }
    });

    window.addEventListener('keyup', function (e) {
      if (e.key === 'ArrowUp') keys.up = false;
      if (e.key === 'ArrowDown') keys.down = false;
    });

    slider.addEventListener('input', function () {
      setMass(sliderToMass(parseFloat(slider.value)));
      noteInteraction();
    });

    if (window.ResizeObserver) {
      new ResizeObserver(resize).observe(canvas);
    }
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);

    function draw() {
      gl.uniform2f(uSimSize, state.simW, state.simH);
      gl.uniform2f(uLens, state.lensX, state.lensY);
      gl.uniform1f(uMass, state.mass);
      gl.uniform1f(uPixelsPerUnit, state.pixelsPerUnit);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame() {
      /* Held arrow keys ramp the mass, as in the Python event loop. */
      if (keys.up) setMass(state.mass * 1.02);
      if (keys.down) setMass(state.mass / 1.02);
      draw();
      requestAnimationFrame(frame);
    }

    resize();
    setMass(MASS_INITIAL);
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
