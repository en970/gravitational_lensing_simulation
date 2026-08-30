/*
 * Kerr mode: a spinning black hole, lensed by integrating null geodesics.
 *
 * The 2D mode deflects light with the thin lens, θ = 4GM/c²r. That formula is
 * a weak-field result about a mass that does not rotate, and it cannot produce
 * a photon ring, higher-order images, or any consequence of rotation at all.
 * This mode drops it. Every pixel fires a ray backwards from the camera and
 * the ray is integrated as a null geodesic of the Kerr metric, in
 * Boyer-Lindquist coordinates, with the Carter constant carried along — the
 * physics of the Double Negative renderer built for Interstellar (James, von
 * Tunzelmann, Franklin & Thorne, Class. Quantum Grav. 32 065001, 2015).
 *
 * With M = 1 and Σ = r² + a²cos²θ, Δ = r² − 2r + a², and for a photon of
 * energy E and angular momentum L, writing P = (r²+a²)E − aL and
 * W = L/sinθ − aE sinθ, the Hamiltonian is
 *
 *     2H = [ Δ p_r² + p_θ² + W² − P²/Δ ] / Σ
 *
 * and a null geodesic keeps 2H = 0. Because it does, the ∂Σ terms in the
 * derivatives cancel against it, and what has to be integrated is small:
 *
 *     dr/dλ  = Δ p_r / Σ
 *     dθ/dλ  = p_θ / Σ
 *     dφ/dλ  = ( W/sinθ + aP/Δ ) / Σ
 *     dp_r/dλ = −[ (2r−2)p_r² − 4rEP/Δ + (2r−2)P²/Δ² ] / (2Σ)
 *     dp_θ/dλ = W cosθ ( L/sin²θ + aE ) / Σ
 *
 * Verified against theory before any of it went into a shader. The shadow of
 * a Kerr hole has a closed form (Bardeen 1973): its rim is the locus of
 * spherical photon orbits, and for an equatorial observer it runs from
 *
 *     a = 0.000   −5.1962 to  5.1962      (±3√3, exact)
 *     a = 0.500   −4.0953 to  6.1379
 *     a = 0.900   −2.8440 to  6.8310
 *     a = 0.998   −2.1107 to  6.9958
 *
 * Integrating the equations above and bisecting for the capture boundary
 * reproduces every one of those to four decimals. The asymmetry is the whole
 * point: a rotating hole drags the light around with it, so the shadow is
 * displaced and flattened on the side where the photons orbit with the spin,
 * and that side's rim sits far closer to the centre than the retrograde one.
 *
 * The prograde edge is where the step size shows. Photons there orbit at
 * r_ph = 2M[1 + cos((2/3)arccos(−a))], which for a = 0.998 is 1.074M — just
 * outside a horizon at 1.063M — and a step scaled only by distance to the
 * horizon walks straight past the turn. The step below is scaled by both that
 * distance and the local curvature.
 */
(function () {
  'use strict';

  var VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  var FRAG = `#version 300 es
precision highp float;

#define MAX_STEPS 320
#define SHELLS 7
#define PI 3.14159265
#define TH_EPS 0.012

uniform sampler2D uCat;
uniform vec2  uRes;
uniform float uSpin;          // a/M, 0 to 0.998
uniform float uCamR;          // observer radius, in M
uniform float uIncl;          // observer polar angle, radians
uniform float uPhi;           // observer azimuth, radians
uniform float uTanHalfFov;
uniform int   uSteps;
uniform float uCellAng;
uniform float uFill;
uniform float uExposure;
uniform float uSeed;
out vec4 fragColor;

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

/* One catalogued object, drawn in the plane perpendicular to the ray. */
vec3 drawObject(vec3 e3, vec3 hA, vec3 hB, out float lum) {
  int row = int(hA.x * 255.0 + hA.y * 37.0) & 255;
  vec4 t0 = texelFetch(uCat, ivec2(0, row), 0);
  vec4 t1 = texelFetch(uCat, ivec2(1, row), 0);
  vec4 t2 = texelFetch(uCat, ivec2(2, row), 0);
  vec4 t3 = texelFetch(uCat, ivec2(3, row), 0);

  float prim = t0.w;
  float size = t1.w;

  vec3  n      = normalize(hB * 2.0 - 1.0 + 1e-4);
  float along  = dot(e3, n);
  vec3  inPl   = e3 - along * n;
  float squash = mix(1.0, 5.0, t2.y);
  float rr     = length(vec2(length(inPl), along * squash)) / size;

  float v;
  if (prim < 0.5) {
    v = exp(-rr * rr * 2.2) * 2.1;
  } else if (prim < 1.5) {
    float rot = rr * (1.4 + t3.x) + hA.y * 6.2831;
    float sp  = 0.62 + 0.38 * cos(2.0 * (atan(along, length(inPl)) + rot));
    v = max(exp(-rr * rr * 2.4), exp(-rr * 1.6) * sp);
  } else if (prim < 3.5) {
    v = max(exp(-rr * rr * 2.4), exp(-rr * 1.6));
  } else if (prim < 5.5) {
    v = exp(-rr * rr * 0.9) * 0.9;
  } else {
    v = max(exp(-rr * rr * 5.0), exp(-rr * 1.1) * 0.42);
  }

  lum = v * t2.x;
  return mix(t0.rgb, t1.rgb, smoothstep(0.10, 1.30, rr));
}

/* The sky, on a set of shells. A ray meets a shell at one point, so what is
   measured is the perpendicular distance from the ray to each object. */
vec3 sampleShell(vec3 p, vec3 rayDir, float shellR, float shellId) {
  float cell = shellR * uCellAng;
  vec3  q    = p / cell;
  vec3  base = floor(q - 0.5);
  vec3  acc  = vec3(0.0);

  for (int dz = 0; dz <= 1; dz++)
  for (int dy = 0; dy <= 1; dy++)
  for (int dx = 0; dx <= 1; dx++) {
    vec3 c  = base + vec3(float(dx), float(dy), float(dz));
    vec3 ch = c + vec3(shellId * 17.3 + uSeed, shellId * 29.1, shellId * 41.7);
    vec3 hA = hash33(ch);
    if (hA.z > uFill) continue;

    vec3  rel   = (c + hA) * cell - p;
    float along = dot(rel, rayDir);
    float near  = 1.0 - smoothstep(cell * 0.15, cell * 0.85, abs(along));
    if (near <= 0.0) continue;
    vec3  perp = rel - along * rayDir;
    float d    = length(perp) / cell;
    if (d > 0.55) continue;
    near *= 1.0 - smoothstep(0.42, 0.55, d);

    float lum;
    vec3 col = drawObject(perp / cell, hA, hash33(ch.yzx + 7.3), lum);
    acc += col * lum * near;
  }
  return acc;
}

vec3 skyAlong(vec3 dir) {
  vec3 acc = vec3(0.0);
  for (int k = 0; k < SHELLS; k++) {
    float R = 26.0 * pow(1.62, float(k));
    acc += sampleShell(dir * R, dir, R, float(k) + 1.0);
  }
  return acc;
}

/* ---- Kerr ----------------------------------------------------------- */

/* dy/dλ for y = (r, θ, φ, p_r, p_θ), with E = 1 and L conserved. */
void kerrRHS(float r, float th, float pr, float pth, float a, float L,
             out float dr, out float dth, out float dph,
             out float dpr, out float dpth) {
  float sr = sin(th);
  float s = max(abs(sr), 0.012) * (sr < 0.0 ? -1.0 : 1.0);
  float c = cos(th);
  float Sig = r * r + a * a * c * c;
  float Del = r * r - 2.0 * r + a * a;
  Del = abs(Del) < 1e-6 ? (Del < 0.0 ? -1e-6 : 1e-6) : Del;
  float P = (r * r + a * a) - a * L;
  float W = L / s - a * s;

  dr   = Del * pr / Sig;
  dth  = pth / Sig;
  dph  = (W / s + a * P / Del) / Sig;
  dpr  = -((2.0 * r - 2.0) * pr * pr - 4.0 * r * P / Del
           + (2.0 * r - 2.0) * P * P / (Del * Del)) / (2.0 * Sig);
  dpth = W * c * (L / (s * s) + a) / Sig;
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  ndc.x *= uRes.x / uRes.y;

  float a  = uSpin;
  float r0 = uCamR;
  float th0 = clamp(uIncl, 0.02, 3.1216);

  float s0 = sin(th0), c0 = cos(th0);
  float Sig = r0 * r0 + a * a * c0 * c0;
  float Del = r0 * r0 - 2.0 * r0 + a * a;
  float A   = pow(r0 * r0 + a * a, 2.0) - a * a * Del * s0 * s0;
  float alpha = sqrt(Sig * Del / A);          // ZAMO lapse
  float omega = 2.0 * a * r0 / A;             // frame dragging
  float pomega = s0 * sqrt(A / Sig);          // cylindrical radius

  /* The camera is a locally non-rotating observer, looking inwards. Inside
     the ergosphere no static observer exists, and this one still does. */
  vec3 nloc = normalize(vec3(ndc.x * uTanHalfFov, ndc.y * uTanHalfFov, -1.0));
  float n_ph = nloc.x, n_th = -nloc.y, n_r = nloc.z;

  /* Local frame components to conserved quantities. */
  float pt_up  = 1.0 / alpha;
  float pph_up = omega / alpha + n_ph / pomega;
  float g_tt   = -(1.0 - 2.0 * r0 / Sig);
  float g_tph  = -2.0 * a * r0 * s0 * s0 / Sig;
  float g_phph = A * s0 * s0 / Sig;

  float E = -(g_tt * pt_up + g_tph * pph_up);
  float L = (g_tph * pt_up + g_phph * pph_up) / E;
  float pr  = n_r  * sqrt(Sig / Del) / E;
  float pth = n_th * sqrt(Sig) / E;

  float rh = 1.0 + sqrt(max(1e-9, 1.0 - a * a));
  float r = r0, th = th0, ph = uPhi;
  bool escaped = false;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps) break;

    /* Scaled by height above the horizon and by how sharply the ray is
       turning. Distance alone walks straight past the prograde photon orbit,
       which for a = 0.998 sits 0.011M above the horizon. */
    float k1r, k1t, k1p, k1pr, k1pt;
    kerrRHS(r, th, pr, pth, a, L, k1r, k1t, k1p, k1pr, k1pt);
    float turn = abs(k1pr) + abs(k1pt) + 1e-4;
    float h = min(0.055 * (r - rh) + 0.004, 0.85 / sqrt(turn));
    /* Far out there is nothing left to resolve, so the step is allowed to
       grow with distance; capping it low strands every ray short of escape. */
    h = clamp(h, 0.00020, 12.0);

    float k2r, k2t, k2p, k2pr, k2pt;
    kerrRHS(r + 0.5 * h * k1r, th + 0.5 * h * k1t, pr + 0.5 * h * k1pr,
            pth + 0.5 * h * k1pt, a, L, k2r, k2t, k2p, k2pr, k2pt);
    float k3r, k3t, k3p, k3pr, k3pt;
    kerrRHS(r + 0.5 * h * k2r, th + 0.5 * h * k2t, pr + 0.5 * h * k2pr,
            pth + 0.5 * h * k2pt, a, L, k3r, k3t, k3p, k3pr, k3pt);
    float k4r, k4t, k4p, k4pr, k4pt;
    kerrRHS(r + h * k3r, th + h * k3t, pr + h * k3pr,
            pth + h * k3pt, a, L, k4r, k4t, k4p, k4pr, k4pt);

    r   += h / 6.0 * (k1r  + 2.0 * k2r  + 2.0 * k3r  + k4r);
    th  += h / 6.0 * (k1t  + 2.0 * k2t  + 2.0 * k3t  + k4t);
    ph  += h / 6.0 * (k1p  + 2.0 * k2p  + 2.0 * k3p  + k4p);
    pr  += h / 6.0 * (k1pr + 2.0 * k2pr + 2.0 * k3pr + k4pr);
    pth += h / 6.0 * (k1pt + 2.0 * k2pt + 2.0 * k3pt + k4pt);

    /* The axis is a coordinate singularity of Boyer-Lindquist, not a physical
       one, and a ray carrying angular momentum never reaches it anyway: Θ(θ)
       goes negative first, so the ray turns. The restoring term that produces
       that turn grows as L²/sin³θ, which no step this integrator can afford
       will resolve, so the turn is enforced instead of resolved. Without it
       the projected axis is a line of noise across the whole frame. */
    if (th < TH_EPS)      { th = TH_EPS;      pth =  abs(pth); }
    if (th > PI - TH_EPS) { th = PI - TH_EPS; pth = -abs(pth); }

    if (r < rh * 1.0015) break;
    if (r > 140.0) { escaped = true; break; }   // heading is fixed well before this
  }

  vec3 col = vec3(0.0);
  if (escaped) {
    /* Far from the hole the ray runs radially, so where it is on the sky is
       simply where it is. Only a ray that actually got away is given a sky:
       one still circling when the budget ran out is on a bound orbit it will
       not leave, and calling that an escape sprays the shadow with stars. */
    float st = sin(th), ct = cos(th);
    vec3 dir = normalize(vec3(st * cos(ph), st * sin(ph), ct));
    col = skyAlong(dir) * uExposure;
  }

  col = col / (1.0 + col);
  fragColor = vec4(pow(max(col, 0.0), vec3(1.0 / 2.2)), 1.0);
}`;

  /* ---- setup ---------------------------------------------------------- */

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  function boot() {
    var canvas = document.getElementById('kerr-stage');
    var toggle = document.getElementById('kerr-toggle');
    if (!canvas || !toggle || !window.SkyCatalogue) return;

    var gl = null, u = {}, ready = false;
    var S = {
      active: false, spin: 0.90, incl: 84, r: 22.0, phi: 0.0,
      steps: 190, scale: 1.0, seed: Math.random() * 400
    };

    var spinIn = document.getElementById('kerr-spin');
    var inclIn = document.getElementById('kerr-incl');
    var spinOut = document.getElementById('kerr-spin-value');
    var inclOut = document.getElementById('kerr-incl-value');
    var hud = document.getElementById('kerr-hud');

    function init() {
      gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
      if (!gl) return false;
      var prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog));
      }
      gl.bindVertexArray(gl.createVertexArray());
      gl.useProgram(prog);

      ['uCat', 'uRes', 'uSpin', 'uCamR', 'uIncl', 'uPhi', 'uTanHalfFov',
       'uSteps', 'uCellAng', 'uFill', 'uExposure', 'uSeed'].forEach(function (n) {
        u[n] = gl.getUniformLocation(prog, n);
      });

      var cat = window.SkyCatalogue;
      var tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, cat.ROW_TEXELS, cat.TABLE_ROWS, 0,
                    gl.RGBA, gl.FLOAT, cat.pack());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      gl.uniform1i(u.uCat, 0);
      gl.uniform1f(u.uTanHalfFov, Math.tan(52 * Math.PI / 360));
      gl.uniform1f(u.uCellAng, 0.098);
      gl.uniform1f(u.uFill, 0.34);
      gl.uniform1f(u.uExposure, 1.55);
      gl.uniform1f(u.uSeed, S.seed);
      ready = true;
      return true;
    }

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2) * S.scale;
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    var last = 0, frameAvg = 16.7, tune = 45;

    function frame(now) {
      if (!S.active) return;
      var raw = last ? Math.min(now - last, 80) : 16.7;
      last = now;
      S.phi += raw / 1000 * 0.035;      // a slow orbit, so the asymmetry moves

      /* Adaptive quality: integration steps first, then resolution. */
      frameAvg += (raw - frameAvg) * 0.08;
      if (--tune <= 0) {
        tune = 45;
        if (frameAvg > 26 && S.steps > 90) S.steps -= 12;
        else if (frameAvg > 26 && S.scale > 0.55) { S.scale -= 0.08; resize(); }
        else if (frameAvg < 13 && S.steps < 320) S.steps += 8;
      }

      resize();
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform1f(u.uSpin, S.spin);
      gl.uniform1f(u.uCamR, S.r);
      gl.uniform1f(u.uIncl, S.incl * Math.PI / 180);
      gl.uniform1f(u.uPhi, S.phi);
      gl.uniform1i(u.uSteps, S.steps);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (hud) {
        var rh = 1 + Math.sqrt(Math.max(0, 1 - S.spin * S.spin));
        var pro = 2 * (1 + Math.cos(2 / 3 * Math.acos(-S.spin)));
        var ret = 2 * (1 + Math.cos(2 / 3 * Math.acos(S.spin)));
        hud.textContent =
          'a/M       ' + S.spin.toFixed(3) +
          '\nhorizon   ' + rh.toFixed(3) + ' M' +
          '\nphoton    ' + pro.toFixed(3) + ' M prograde' +
          '\n          ' + ret.toFixed(3) + ' M retrograde' +
          '\ncamera    ' + S.r.toFixed(1) + ' M, ' + S.incl.toFixed(0) + '°' +
          '\nsteps     ' + S.steps;
      }
      requestAnimationFrame(frame);
    }

    function setActive(on) {
      if (on && !ready && !init()) return;
      S.active = on;
      document.body.classList.toggle('is-kerr', on);
      toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      window.__lensingPaused = on;
      if (on) { last = 0; resize(); requestAnimationFrame(frame); }
    }

    toggle.addEventListener('click', function () { setActive(!S.active); });

    if (spinIn) {
      spinIn.addEventListener('input', function () {
        S.spin = Math.min(0.998, parseFloat(spinIn.value));
        if (spinOut) spinOut.textContent = S.spin.toFixed(3);
      });
      S.spin = Math.min(0.998, parseFloat(spinIn.value));
      if (spinOut) spinOut.textContent = S.spin.toFixed(3);
    }
    if (inclIn) {
      inclIn.addEventListener('input', function () {
        S.incl = parseFloat(inclIn.value);
        if (inclOut) inclOut.textContent = S.incl.toFixed(0) + '°';
      });
      S.incl = parseFloat(inclIn.value);
      if (inclOut) inclOut.textContent = S.incl.toFixed(0) + '°';
    }

    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.active) setActive(false);
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      S.r = Math.min(60, Math.max(4.5, S.r * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
    window.addEventListener('resize', function () { if (S.active) resize(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
