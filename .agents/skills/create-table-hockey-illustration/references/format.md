# Editable illustration format

## Files and references

- Scene: `src/content/illustrations/<slug>.json`
- Combination: `src/content/tricks/<slug>.json`
- Shared rink: `public/illustrations/rinks/stiga-playoff-v1.png`
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
  ]
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

## Verification checklist

1. Description and arrows express the same sequence.
2. Numbers follow the puck/action order.
3. Final shot or endpoint is visible.
4. Labels do not obscure the active player.
5. Crop retains enough rails/goal context to understand the move.
6. Catalogue thumbnail is legible without relying on hover.
7. Norwegian and English detail pages render the same scene.
