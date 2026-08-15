---
name: create-table-hockey-illustration
description: Create, trace, edit, validate, and visually verify editable puck.no table-hockey combination illustrations stored as JSON scenes and rendered as SVG. Use when adding a missing combination illustration, converting a legacy diagram image, changing movement arrows or numbered steps, selecting an illustration crop, or debugging the illustration editor/renderer.
---

# Create table hockey illustration

Keep the movement data editable. Never create a new PNG, GIF, embedded rink, or one-off SVG as the source of truth.

## Workflow

1. Read `src/content/tricks/<slug>.json`. Do not infer an ambiguous movement from its name alone. Preserve the legacy `diagram` until the new scene has been visually verified.
2. Read [references/format.md](references/format.md) before editing scene data.
3. When no legacy diagram exists, read [references/movement-language.md](references/movement-language.md) and run `npm run illustration:draft -- <slug> --write`. Import the generated draft and resolve every warning before publishing it.
4. Create or edit `src/content/illustrations/<slug>.json`. Set `illustration` in the trick record to the same slug.
5. Start from the editor's six-player default setup, then remove actors that do not help explain the combination. Use `attacker` for the player(s) performing the combination, `defender` for opponents, and `goalie` for the keeper. Assign roles whenever known so players stay attached to their physical rod paths.
6. Prefer `/admin/illustrasjoner/` for tracing and direct manipulation. For agent-authored coordinate changes, edit JSON directly and use the editor's grid/raw JSON panel for inspection.
7. Use one path per numbered action. Keep steps consecutive from 1. Let the shared renderer control colours, widths, arrowheads, fonts, rink asset, player sprites, pivots, and labels.
8. Run `npm run check:illustrations` and `npm run check`.
9. Run `npm run build`, open both the catalogue thumbnail and detail page at desktop and 375 px, and compare against the description or legacy reference. Check that players, arrowheads, labels, and the decisive endpoint remain visible inside the crop. For migrated scenes, use `/admin/illustrasjoner/kontroll/` for a direct side-by-side comparison.

If the written description is insufficient to locate a pass, wall bounce, feint, or shot confidently, stop and request table-hockey expertise. Do not fabricate technically precise movement data.

## Quality rules

- Use the smallest crop that contains every path plus useful rink context.
- Place labels near the start of their path without covering a player or rail.
- Keep player anchors on their physical rod position. Role-assigned players snap to shared rod guides in the editor; use a `null` role only when deliberately placing a free actor. Rotate and scale the shared sprite; never embed a per-scene image or pivot.
- Show only players that help explain the situation. The active attackers, relevant defenders, and goalie are normally enough.
- Keep `puck` set to `null`. The numbered movement arrows already show the puck route, so a separate puck marker adds clutter.
- Use `pass` for puck transfers, `shot` for the final attempt on goal, and `move` only for player movement.
- Ordinary passes and rebounds must use `curve: false`. A puck travels in straight lines between contacts.
- Use exactly two points for a direct pass. Add sparse intermediate points only at a real rail or post contact, producing distinct straight legs with sharp direction changes.
- When the puck stays against the rounded wall behind a goal, set both `curve: true` and `followsWall: true` and trace the wall with enough points to keep the route on the boards. This is the only curved puck-path exception.
- Use `curve: true` without `followsWall` only for a deliberately smooth player movement.
- Keep all coordinates in the 415 × 720 rink coordinate system.
- Keep the legacy raster as fallback until human comparison approves the editable scene.
