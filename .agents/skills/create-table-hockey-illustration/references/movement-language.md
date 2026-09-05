# Description-to-illustration planning

Use the local planner to turn a combination description into a grounded, editable starting point:

```bash
npm run illustration:draft -- <slug> --write
```

The command writes two ignored files in `migration/illustration-drafts/`:

- `<slug>.json`: a scene that can be imported into `/admin/illustrasjoner/`
- `<slug>.brief.json`: the recognized route, confidence, and review warnings

The planner is deterministic, offline, and free. It recognizes player roles, explicit passing order, forward/backward movement, common goal targets, and named rail directions. It deliberately treats specialist technique words as evidence gaps rather than pretending that prose determines exact coordinates.

## Accuracy contract

1. Every arrow must be supported by a phrase in the Norwegian description, a legacy diagram, a video, or explicit table-hockey expertise.
2. A generated draft is never publishable merely because it validates structurally.
3. Resolve every item in the review brief. If a term describes stick technique rather than puck travel, keep it out of the puck path unless a visual reference establishes the motion.
4. Use the side-by-side page at `/admin/illustrasjoner/kontroll/` whenever a legacy diagram exists.
5. Only after visual or expert review, copy the scene to `src/content/illustrations/<slug>.json` and set `illustration` in the matching trick record.

## Supported anchors

- `center`
- `left-wing`
- `right-wing`
- `left-defense`
- `right-defense`
- `goalie`
- attacking goal and named left/right corners
- left/right rail, behind the attacking goal, and behind the player's own goal

## Expected review warnings

Warnings are normal for terms such as kiosk, skyffel, smyger, heel/stick pocket, spins, lifts, post rebounds, goalie banks, named corners, and full-rink rail routes. They identify where an agent should ask for expertise or use a video instead of inventing movement data.
