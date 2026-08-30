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
the lens is not bent at all.

The repository holds two implementations of the same calculation. The equations,
constants and background layout are identical between them.

| | Web | Python |
|---|---|---|
| Entry point | `index.html` | `main.py` |
| Computation | WebGL2 fragment shader (GPU) | NumPy (CPU) |
| Background | A volume walked in depth | One plane |
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

Left alone for a second, the lens drifts on its own along a
closed path — two sines of incommensurable frequency, each slowly modulated, so
it stays in frame and never repeats. It is blended in rather than switched to,
so control is handed over without a jump.

Taking it back needs a click. Moving the pointer is not enough, and that is
deliberate: the mass and the distance are worth changing while the lens wanders
on its own, and a cursor that reclaimed it on the way to a slider would make
that impossible. The mass, the distance and the sliders all stay live while it
drifts and none of them interrupts it. Before the first interaction of the
session the pointer does take it back, since nobody yet has any reason to know
a click is what does.

An earlier version wrapped the lens around the edges of the field instead. That
looked like the page reloading, and the reason is worth recording: the
deflection never actually reaches zero. Even with the lens far outside the
viewport, θ_E²/θ still shifts the whole sky by a visible amount, so every wrap
moved the stars. A bounded path has no such discontinuity.

**Ambient** hands the lens to that path permanently, hides the interface and the
cursor, and ignores the pointer — a screensaver. A tap, a click or Escape exits.

| Action | Desktop | Touch |
|---|---|---|
| Take the lens back from the drift | Click | Tap |
| Move the mass across the sky | Move the cursor | Drag |
| Move it along the line of sight | Scroll | Pinch |
| Change the mass | Up and down arrow keys | — |
| Either, precisely | The sliders | The sliders |

### Structure

```
index.html          the page, with the simulation and a description of the physics
src/lensing.js      WebGL2 setup, the lensing shader, and input handling
src/catalogue.js    154 object types, packed into a weighted lookup table
src/style.css       page styling
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
sphere, they are darkened.

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

And the stars scintillate, which nothing in this scene has any business doing.
Twinkling is a property of the air between the source and the eye rather than of
the source itself: a point source is covered by a single patch of disturbed
wavefront, so its brightness varies as that patch drifts, while anything with
angular extent is covered by many patches at once and averages over them. That
distinction is real and it is kept — the effect is applied inside the point
primitive alone, so stars vary and galaxies, nebulae and remnants do not. The
rest of it is a deliberate departure. An observer placed to see this lensing
would be above any atmosphere, and real scintillation is orders of magnitude
faster than the roughly one-second beat used here, which at frame rate would
read as noise rather than as sky. That beat is still quick enough to be told
apart from the sky sliding under a moving lens, which a slower one is not: the
motion swamps it and the shimmer only reads once the lens is nearly still. The
amplitude is six per cent peak to peak, set by `SCINT` in `src/lensing.js`;
zero removes it.

## The sky

The background is generated from a hash inside the shader rather than from a
texture. It is therefore unbounded — there is no edge for the deflection to run
off, which is what smeared the image at high mass — it costs nothing to load,
and it stays sharp at any magnification.

What populates it comes from `src/catalogue.js`: 154 object types following the
real taxonomy.

| Category | Types | Examples |
|---|---|---|
| Stars | 77 | O3 V through Y1, giants and supergiants, white and brown dwarfs, Wolf-Rayets, Cepheids, Miras, neutron stars, magnetars, twelve supernova subtypes |
| Galaxies | 42 | E0–E6, S0, Sa–Sd, SBa–SBd, irregulars, dwarfs, ring and polar-ring, mergers, ULIRGs, Seyferts, FR I/II radio galaxies, quasars, blazars, Lyman-break |
| Nebulae | 25 | H II regions, reflection and dark nebulae, Bok globules, planetary nebulae (round, elliptical, bipolar, ring), supernova remnants (shell, plerion, Cas A-type), Herbig-Haro |
| Clusters | 10 | Open clusters young to old, globulars metal-rich and metal-poor, OB and T associations |

Types carry weights, so the mix on screen reflects the mix in space: M dwarfs
are everywhere, O stars are rare, faint dwarf galaxies outnumber giant
ellipticals. Stellar colours are blackbody, computed from temperature rather
than picked by hand.

Every type reduces to one of eight drawing primitives plus parameters, so shader
cost is independent of how long the catalogue grows, and the list is packed into
a 256-row table with types repeated in proportion to weight — selection is a
single `texelFetch` with no search. Objects are inclined by a random axis ratio,
so most present as ellipses rather than face-on discs, and everything reddens
with distance.

The catalogue is *faster* than the three hand-written shapes it replaced —
9.1 ms against 15.5 ms per frame at 1280x860 on an M1 — because nothing in it is
wider than 0.52 cell units, so most of the 3x3 neighbourhood is rejected before
the catalogue is read at all.

### The bench in `lab/`

Two pages, neither of them part of the simulation, for one open question: what
the catalogue's galaxies look like if their light is carried by individual
stars instead of by a smooth profile. `lab/morphologies.html` puts nine
morphologies side by side with the resolution, the star density and the
exposure on sliders. `lab/sky.html` fills a field with them, at five depths,
and reloads into a different sky each time.

The shape still comes from a density field, the same one a smooth profile would
use. What changed is the sampling: a jittered lattice of point stars weighted by
that field, at two scales — a coarse one for the stars bright enough to stand
alone and a finer one for the crowd just short of resolving — with luminosities
from a steep power law, so a few stand out and the rest make the glow. An
unresolved component always remains, because a real core never resolves either.

Two things came out of it that are worth keeping whatever is done with the rest.
Orientation is the first: drawing cos(i) uniformly is what "randomly oriented in
space" actually means, and it makes a face-on disc rare — half of all discs are
inclined past 60 degrees. A field drawn that way looks immediately less arranged
than one where everything faces the viewer. It needs three things to hold up: a
disc thickness, or an edge-on galaxy collapses to a single row of pixels; a
bulge that stays spherical while the disc flattens, which is what reads as
edge-on rather than as a line; and a dust lane that only appears once the
inclination is steep enough to be looking through the disc rather than down onto
it.

The second is that resolution belongs to distance. A galaxy far enough away does
not resolve into stars at all, so the resolved fraction is ramped across the
depth slices rather than set once — which is both the honest rendering and the
cheaper one.

Nothing here is wired into `src/lensing.js` yet. Doing so has a cost to answer
first: the star lattice is eighteen hash evaluations per object, and the
simulation already walks up to 32 depths of a 3x3 neighbourhood.

## Differences between the two versions

The physics is unchanged. The web version differs in its rendering only:

- The background has volume: the sky is sampled at many depths, each with its
  own Einstein radius, and the lens can be moved along the line of sight.
  `main.py` has one plane at a fixed distance. At the reference geometry the two
  agree exactly.
- Render scale adapts to measured frame time, so the simulation holds its frame
  rate on hardware of very different capability. Depth sample count is *not* a
  quality dial and is fixed per device: a sample maps to shell
  floor(i * 26/steps), so lowering the count lands on a different set of shells
  — 18 samples to 17 drops 8 shells and picks up 7 — and half the sky would be
  rebuilt in place. Render scale is safe because simW = 600 * w / min(w, h) is
  invariant when w and h scale together, so objects keep their positions and
  only sampling density changes. Verified: the same scene at two render scales
  gives identical mean brightness and lit fraction.
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
