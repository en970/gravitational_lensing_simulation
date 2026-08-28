# Gravitational Lensing Simulation

A real-time visualization of gravitational lensing based on Einstein's General
Relativity. Light from a background star field is deflected by a movable mass,
using the thin-lens approximation, computed for every pixel on screen.

**Run it in the browser:** https://en970.github.io/gravitational_lensing_simulation/

The repository holds two implementations of the same calculation. The equations,
constants and background layout are identical between them.

| | Web | Python |
|---|---|---|
| Entry point | `index.html` | `main.py` |
| Computation | WebGL2 fragment shader (GPU) | NumPy (CPU) |
| Display | Any viewport, desktop and mobile | Fixed 800x600 window |
| Requirements | A browser with WebGL2 | `pygame`, `numpy` |

## Web version

Open the link above, or serve the directory locally:

```
python3 -m http.server
```

Then visit `http://localhost:8000/`.

### Controls

| Action | Desktop | Touch |
|---|---|---|
| Move the mass | Move the cursor | Drag |
| Change the mass | Scroll, or the up and down arrow keys | Pinch |
| Change the mass | The slider, on either | |

### Structure

```
index.html          the page, with the simulation and a description of the physics
src/lensing.js      WebGL2 setup, the lensing shader, and input handling
src/background.js   generation of the background star field
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

This is Einstein's thin-lens approximation. The image is built by working
backwards: for each screen pixel at an angular distance θ from the lens centre,
the source-plane position is

    β = θ - θ_E² / θ

where θ_E is the Einstein radius. The pixel takes the brightness of the
background at β, magnified by

    µ = | θ / β |

which is clamped to a factor of four. Where β passes through zero the source is
smeared into a complete Einstein ring. Inside the Schwarzschild radius r_s the
pixels are black; between r_s and 1.5 r_s, the photon sphere, they are darkened.
A thin white circle marks r_s.

The thin-lens formula is a weak-field result, and both implementations apply it
right up to the horizon, where it no longer holds. A correct treatment there
requires integrating null geodesics in the Schwarzschild metric, which produces
higher-order images the thin lens cannot reproduce.

## Differences between the two versions

The physics is unchanged. The web version differs in its rendering only:

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
