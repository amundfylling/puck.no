# Editable illustration format

## Files and references

- Scene: `src/content/illustrations/<slug>.json`
- Combination: `src/content/tricks/<slug>.json`
- Shared rink: `public/illustrations/rinks/stiga-playoff-v1.png`
- Shared players: `public/illustrations/players/`
- Renderer: `src/components/TrickIllustration.astro`
- Editor: `/admin/illustrasjoner/`
- Deterministic validator: `npm run check:illustrations`

The scene filename, scene `slug`, trick filename, trick `slug`, and trick `illustration` must match.

## Coordinate system

Use the source rink's native coordinate system:

- Width: `415`, left to right
- Height: `720`, top to bottom
- Attacking goal: near the top edge
- Approximate top-goal target: `(208, 125)`
- Approximate attacking centre: `(208, 228)`
- Approximate attacking left wing: `(60, 260)`
- Approximate centre line: `y = 360`

Treat landmarks as orientation hints, not movement facts. Use the editor grid and the actual rink image for placement.

## Schema

```json
{
  "slug": "example",
  "version": 1,
  "rink": "stiga-playoff-v1",
  "viewport": { "x": 0, "y": 0, "width": 415, "height": 303 },
  "paths": [
    {
      "id": "step-1",
      "step": 1,
      "kind": "pass",
      "curve": false,
      "points": [[208, 228], [60, 260]],
      "label": [208, 228]
    }
  ],
  "players": [
    {
      "id": "attacking-center",
      "kind": "attacker",
      "role": "center",
      "position": [208, 228],
      "rotation": -90,
      "scale": 0.95
    }
  ],
  "puck": { "position": [205, 216], "radius": 5 }
}
```

### Viewport

The viewport is an SVG viewBox in rink coordinates. Editor presets are:

- `offensive-zone`: `{ "x": 0, "y": 0, "width": 415, "height": 303 }`
- `half-rink`: `{ "x": 0, "y": 0, "width": 415, "height": 415 }`
- `full-rink`: `{ "x": 0, "y": 0, "width": 415, "height": 720 }`

Use a custom viewport only when these crop a meaningful path or leave excessive empty rink.

### Paths

- `id`: `step-<n>` after editor normalization.
- `step`: unique consecutive integer starting at 1.
- `kind`: `pass`, `move`, or `shot`.
- `curve`: render a smooth curve through three or more points.
- `points`: ordered `[x, y]` path points; the arrowhead is placed at the final point.
- `label`: centre of the black numbered marker, normally close to the first point.

The renderer intentionally owns visual styling. Do not add colours, stroke widths, font names, arbitrary image URLs, or animation timing to version 1 scenes.

### Players

- `id`: unique stable slug inside the scene, preferably semantic (`attacking-center`, `defending-goalie`).
- `kind`: `attacker` (yellow sprite), `defender` (white sprite), or `goalie`.
- `role`: optional `center`, `left-wing`, `right-wing`, `left-defense`, `right-defense`, or `goalie`.
- `position`: the physical rotation/pivot point on the rink, not the image's top-left corner. In the editor, a player with a role snaps to the matching rod path traced from `th_animator`; a player without a role can move freely.
- `rotation`: degrees from the shared sprite's source orientation, from `-360` to `360`.
- `scale`: `0.5`–`1.5`; start near `1` and change only when needed for visual fit.

Sprite files, intrinsic dimensions, display sizes, pivot fractions, rod guides, and the six-player starting layout are centralized in `src/lib/illustrations.ts`. New editor scenes begin with three attackers, two defenders, and one goalie. Scenes must never contain image URLs, embedded base64, custom pivots, or copied guide geometry. This keeps the JSON compact and lets every illustration improve when the shared layout is refined.

### Puck

`puck` is either `null` or an object with `position` and a `radius` from `3` to `12`. Put it at the initial position for the illustrated sequence. The movement paths explain subsequent puck travel.

## Verification checklist

1. Description and arrows express the same sequence.
2. Numbers follow the puck/action order.
3. Final shot or endpoint is visible.
4. Players and the initial puck match the written sequence.
5. Labels do not obscure a player or puck.
6. Crop retains enough rails/goal context to understand the move.
7. Catalogue thumbnail is legible without relying on hover.
8. Norwegian and English detail pages render the same scene.
