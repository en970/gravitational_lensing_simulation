# Gravitational Lensing Simulation

### [Run the simulation &rarr;](https://en970.github.io/gravitational_lensing_simulation/)

A real-time visualization of gravitational lensing based on Einstein's General
Relativity. Light from a background is deflected by a mass that can be moved
across the sky and along the line of sight, using the thin-lens approximation,
computed for every pixel on screen. It runs in the browser on desktop and
mobile, with no installation.

The background has volume. Rather than lensing one flat image, the shader walks
the line of sight, sampling the sky at a sequence of depths and deflecting each
depth by its own Einstein radius — multi-plane lensing in the limit of many
planes. Material further away is bent more strongly, and material in front of
the lens is not bent at all. Three real Hubble images can be used instead.

The repository holds two implementations of the same calculation. The equations,
constants and background layout are identical between them.

| | Web | Python |
|---|---|---|
| Entry point | `index.html` | `main.py` |
| Computation | WebGL2 fragment shader (GPU) | NumPy (CPU) |
| Background | A volume walked in depth, or a Hubble image | One plane |
| Lens position | Across the sky and along the line of sight | Across the sky |
| Display | Any viewport, desktop and mobile | Fixed 800x600 window |
| Requirements | A browser with WebGL2 | `pygame`, `numpy` |

## Web version

Open <https://en970.github.io/gravitational_lensing_simulation/>, or serve the
directory locally:

```
python3 -m http.server
```

Then visit `http://localhost:8000/`.

### Controls

| Action | Desktop | Touch |
|---|---|---|
| Move the mass across the sky | Move the cursor | Drag |
| Move it along the line of sight | Scroll | Pinch |
| Change the mass | Up and down arrow keys | — |
| Either, precisely | The sliders | The sliders |

### Structure

```
index.html          the page, with the simulation and a description of the physics
src/lensing.js      WebGL2 setup, the lensing shader, and input handling
src/style.css       page styling
images/             Hubble backgrounds, two resolutions each
```

## Python version

```
pip install pygame numpy
python main.py
```

Mouse moves the black hole, the scroll wheel and the up and down arrow keys
adjust the mass, and ESC exits.

## Physics

For a light ray passing at a distance *r* from a point mass *M*, the deflection
angle in the weak-field limit is

    θ = 4GM / c²r

This is Einstein's thin-lens approximation. How strongly a given mass lenses a
given source is not a property of the mass alone: it depends on where the lens
sits between observer and source. With *D_L* the distance to the lens, *D_S* the
distance to the source and *D_LS* the distance between them, the Einstein radius
is

    θ_E² = (4GM/c²) · D_LS / (D_L · D_S)

Distances are in units of a reference source distance *D_S* = 1, with the
reference lens at *D_L* = 0.5, where the geometric factor is exactly 1.
Calibrating θ_E = 20M there reproduces `main.py` unchanged and gives, for any
other geometry,

    θ_E² = (20M)² · (D_S − D_L) / (D_L · D_S)

Three consequences, all visible on screen:

- **A more distant source is lensed more strongly.** The volume is sampled
  between *D_S* = 0.16 and 3.60, logarithmically, so the arcs at different
  depths do not coincide and the scene reads as depth rather than as sheets.
- **A source in front of the lens is not lensed, and is not hidden by it.** When
  *D_S* ≤ *D_L* there is no deflection, and the horizon does not occlude that
  plane either, since it lies behind it. Push the lens away and the planes drop
  out one at a time, nearest first, until the foreground stars sit undisturbed
  over a black disc.
- **The horizon subtends a smaller angle from further away.** With r_s = 1.5M in
  the same length units, its angular size is r_s / D_L, which is 3M at the
  reference distance, as in `main.py`.

The image is built by working backwards. For each screen pixel at an angular
distance θ from the lens centre, and at each sampled depth, the source-plane
position is

    β = θ − θ_E² / θ

That depth contributes its brightness at β, magnified by µ = | θ / β | and clamped
to a factor of four, and the depths are added, because light adds. Where β passes
through zero the source is smeared into a complete Einstein ring. Inside the
Schwarzschild radius the pixels are black; between r_s and 1.5 r_s, the photon
sphere, they are darkened. A thin white circle marks r_s.

### Where the approximation ends

The thin-lens formula is a weak-field result, and both implementations apply it
right up to the horizon, where it no longer holds; a correct treatment there
requires integrating null geodesics in the Schwarzschild metric, which produces
higher-order images the thin lens cannot reproduce. Distances are treated as
adding and subtracting in flat space, so *D_LS* = *D_S* − *D_L*; in cosmology the
angular diameter distances do not combine that way, so these distances order the
scene correctly without standing for real redshifts. And the deflection at each
depth is computed independently, rather than accumulating along the ray as true
multi-plane lensing does.

## Backgrounds

The procedural sky is generated from a hash inside the shader rather than from a
texture. It is therefore unbounded — there is no edge for the deflection to run
off, which is what smeared the image at high mass — it costs nothing to load,
and it stays sharp at any magnification. Nearby stars run blue-white and distant
galaxies redden, which is both the real trend and a depth cue.

The three photographic backgrounds are real Hubble images, and are single planes
at *D_S* = 1.5, since a photograph records no depth.

| Background | Source | Credit |
|---|---|---|
| Ultra Deep Field | [heic0611b](https://esahubble.org/images/heic0611b/) | NASA, ESA, S. Beckwith (STScI) and the HUDF Team |
| eXtreme Deep Field | [heic1214a](https://esahubble.org/images/heic1214a/) | NASA, ESA, G. Illingworth, D. Magee, P. Oesch, R. Bouwens and the HUDF09 Team |
| Abell 370 | [heic1711a](https://esahubble.org/images/heic1711a/) | NASA, ESA/Hubble, HST Frontier Fields |

Used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), per the
[ESA/Hubble copyright terms](https://esahubble.org/copyright/). Each keeps its
original aspect ratio, uncropped, and is served at two resolutions — the long
edge at 4096 and at 2048, never upscaled past the source. The page loads the
larger one where the device's `MAX_TEXTURE_SIZE` and screen allow it. Images are
fetched only when selected, and a **Fill / Fit** toggle chooses between covering
the viewport and showing the whole frame.

The arcs already visible in Abell 370 are real gravitational lensing, produced by
that cluster's own mass. Placing the simulated lens over it puts one lens in
front of another.

## Differences between the two versions

The physics is unchanged. The web version differs in its rendering only:

- The background has volume: the sky is sampled at many depths, each with its
  own Einstein radius, and the lens can be moved along the line of sight.
  `main.py` has one plane at a fixed distance. At the reference geometry the two
  agree exactly.
- Depth sample count and render scale adapt to measured frame time, so the
  simulation holds its frame rate on hardware of very different capability.
- The background is sampled bilinearly rather than at the nearest texel, which
  removes the pixel break-up visible under magnification in the Python version.
- It renders at the display's own resolution, and the shorter side of the
  viewport is taken as 600 simulation units, so the field covers portrait and
  landscape screens alike rather than a fixed 800x600 window.
- In `add_nebula`, `main.py` applies the radial window to the noise term only,
  which leaves the exponential term stepping to zero at the edge of its bounding
  box and draws a visible rectangle. The web version windows both terms.

## Licence

MIT.
