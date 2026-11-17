# Watch Tower and learning-page loading

Scope: the approved single front logo, enlarged to about 90% of the roof width, and continuously rotating double-sided light. Standalone entry at /learning/watch-tower/ returns to /learning/. Existing entry hash is passed through unchanged. Existing device identity remains owned by entry-identity.js; no identity, progress, reward or API code changed.

The hub, idiom island and English island each load one shared animation/navigation script. Loading contains only the tower and beams, no brand/title/button. It does not delay navigation for display; load, pageshow, errors and rejection dismiss it. A 15-second safety timeout prevents a permanently covered stalled page. Same-page anchors, other origins/routes, downloads, modified clicks and new tabs are excluded. Reduced-motion uses the static source frame.

## QA

- Learning release differs in exactly five paths: three HTML files gain only one script tag, plus watch-tower.js and watch-tower/index.html. Every other baseline release file is byte-identical.
- Chromium 320/390/1280: standalone entry, return to hub, inter-island navigation, pure tower loading during a delayed test-only image request, load dismissal, back navigation and hash preservation pass. No real-account writes.
- Current canonical browser regression list: 98 tests and five standalone scripts pass when run in bounded batches. New dedicated Watch Tower browser test passes. This is not physical iPhone or Safari acceptance.
- Release governance and identity tests: 51 pass.
- Existing unrelated root failures remain: investment provider User-Agent brand expectation and four ERP legacy assertions. Reproduced on untouched main. Full root PASS and FullSource packaging are NOT claimed.

## Release state

Candidate source only. No main promotion, Pages deployment, Render changes, database writes, or TF feature changes performed by this QA preparation. All root build/cache string changes are generated identity projections from the existing sync-build tool; Published C identity is preserved.

## Beam bounds correction, Build 20261117-1221

- User-reported clipping reproduced: 360-unit canvas clipped the projected cones during side sweeps.
- Canvas expanded to 720 logical units without resizing the tower, logo or layout. Light reaches transparent before its outer boundary and viewport edges.
- Full 0-16 second sweep sampled at 1-second intervals at 320/390/1280, visually inspected. Entry/loading/return/hash regression passes at all widths.
- Existing P0 run 44015601330 passes all five checks for the executable bundle; identity projections require a fresh run.
- Only watch-tower.js changes inside the bundle; all other 12 payload files remain byte-identical. No Office route or real learner data changes. FullSource remains separate and no full-root PASS is claimed.
