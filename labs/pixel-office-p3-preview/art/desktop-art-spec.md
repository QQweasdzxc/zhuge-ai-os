# P3 Desktop Office Art Spec

Status: **visual reference only**. This document and `desktop-floorplan.svg` do not implement a second renderer, interactive scene, task source, or live activity feed. The approved scene authority remains the pinned Habblaud native Canvas build.

## Canvas target

- Reference viewport: 1920×1080 and 1440×900; verify a narrow desktop viewport after those two.
- Logical plan: 72×42 tiles. Habblaud uses `TILE = 16` world pixels, so the reference footprint is 1152×672 world pixels.
- The SVG uses a 1440×900 viewBox, with the 72×42 footprint drawn at 18 SVG pixels per logical tile. Its zones are a coordinate guide, not a runtime coordinate source.
- Keep the office as one connected indoor floor. View priority is the complete floor first; native camera fitting may zoom out, but characters and room labels must remain legible at 1440×900.

## Plan coordinates

Coordinates are top-left origin, tile units, half-open ranges `[start, end)`. The south entrance is at the bottom of the plan.

| Area | Tile rectangle | Design |
| --- | --- | --- |
| Tools / print | `x=2..20, y=3..18` | Shelves, filing, printer against edges; preserve a clear center and a 4-tile south opening. |
| Open work area | `x=21..49, y=3..18` | Four two-person desk islands. Furniture remains out of the 3-tile-plus circulation lanes. |
| Enclosed meeting room | `x=50..70, y=3..18` | Three closed walls plus a south wall with a 4-tile door gap, a visible door swing, 3×2 meeting table and six seats. Connect the doorway directly to the main corridor. |
| Main corridor | `x=1..71, y=18..24` | Continuous east-west route, nominally 6 tiles deep; keep at least 3 tiles clear of furniture. |
| Lounge | `x=2..21, y=24..41` | Sofas, coffee table and open social floor; an open north threshold connects to the corridor. |
| Reception / lobby | `x=22..50, y=24..41` | Main south entrance, central north-south spine, reception desk and an award display mounted on an interior wall. |
| Reading / rest | `x=50..70, y=24..41` | Bookshelves and seats on the perimeter, open floor and a north threshold to the corridor. |

The SVG has a few intentionally widened visual gaps between zones; the table above records the logical plan. When translating to native layout, keep the central spine and corridor connected, maintain door openings as walkable cells, and ensure furniture footprints cannot seal any route. The meeting room must remain physically separate from the open work area; its door is the only normal entry.

## Native integration guidance

- Translate the approved geometry into TaskFlow-owned Habblaud `AreaLayout` data through the integration Overlay. Use native `floors`, `walls`, `wallItems`, `furniture`, `spots`, `walkable`, `blocked`, and `door` fields so the original renderer, hit testing, character simulation, and pathfinding remain authoritative.
- Reuse available native furniture definitions before adding art: `meeting_table`, `stool`, `glass_partition`, `bookshelf`, `binder_shelf`, `printer`, `sofa`, `armchair`, `beanbag`, `reception_desk`, `painting`, `shelf_wall`, `door_frame`, `sign`, and `whiteboard`.
- The P2 award wall and meeting entry currently include parent-page DOM furniture. The accepted wall should be drawn on the lobby interior wall. Preserve known links and labels, but do not invent the AI command-cockpit or TF-03 URL. Any Canvas click action needs an explicit native hit-zone/selection extension; do not simulate a positioned overlay as physical in-world interaction.
- Keep the Habblaud upstream pinned at its existing SHA and unmodified. Build changes belong only under `integrations/habblaud/overrides/` and `integrations/habblaud/build.mjs`.
- Keep the P3 personnel contract separate from art: `agent` and `resident` identity, provenance, `source`, `updatedAt`, `taskId/ref`, and `freshness` remain Co-owned integration data. Residents' animations must never imply human location or real work.
- PR #65's art may inform palette, pixel treatment, character readability and furniture styling. Its inline SVG and absolute-positioned HTML characters are not to be embedded as a second live world renderer.

## View and circulation priorities

1. At 1920×1080, show the full floor with a useful margin around the exterior wall and without clipping the south entrance or room labels.
2. At 1440×900, keep the full office as the default view. If a roster or details panel reduces the canvas, use the native camera's available area/insets; do not shrink or replace characters with tiny SVG sprites.
3. At narrow desktop width, allow native panels to collapse and the camera to fit the entire floor. Furniture must not cover the primary aisle, lobby spine or meeting doorway.
4. Show secondary room/door text only where it stays legible. Do not make visual labels the only accessible navigation or action.

## Art acceptance notes

- Award medals are visibly mounted inside the reception/lobby rather than floating outside the office shell.
- The meeting room reads as a genuinely enclosed room: continuous walls, one visible doorway, a table, seats, and a clear approach path.
- Work islands, Lounge, reading/rest, tool zone and main hall belong to the same interior floor.
- The green dashed paths in the SVG are movement-clearance intent only; runtime walkability still has to be verified from the generated native `WalkGrid` and actual character movement.
- This reference is not a screenshot or a claim that the native layout has already been implemented or QA-tested.
