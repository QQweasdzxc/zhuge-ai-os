# P3 Pixel Office isolated interactive lab (review only)

This prototype lives **only** on \`review/pixel-office-p3-isolated-20261018\` and must **not** be merged into main without a separate PM release GO. Official production remains \`0.9.0-alpha.9.76\` on GitHub Pages.

## Demonstrated behavior
- Large mobile-first single office scene and scalable, pannable world. Four QA contexts: phone portrait, phone landscape, desktop landscape, desktop narrow/portrait.
- Native HTML/CSS illustrated office with three walking sample characters (PM / Co / Gem) and black cat.
- User-controlled animation pause, role details and clickable office zones.
- Owner-approved P2 deployed SHA \`a9db9b2fe3051e22d59e52ad083c8d54d12dba62\` is the only reward anchor; reward claim +500 coins once per local browser; client-only localStorage.
- Daily Taipei-date 3-item furniture shop, separate pet shop. No real money or chance-purchase.
- Disclosure: display movement is simulated only, **never** presented as live TaskFlow / Codex / Gem events. No external network calls, secrets or backend mutation.

## Preview and adoption
Hosted via a **read-only public GitHub raw preview proxy** using the exact branch/commit files; not a production deployment or separate official service. Source is public because the upstream repo is public; no private assets or user data included.
Before PM GO: cross-browser/real iPhone UX, keyboard/accessibility, transparent reward policy, provenance integration, full package QA. Real collaboration requires independent Gate1/TaskFlow permissions.

## Iteration 2
Added zoom +/−/reset and mobile pinch; four orientation CSS; roaming waypoints; keyboard cast support; pet ownership once + free switching; remains independent WIP and no release authority.

## Iteration 3 — Visual fidelity pass (no generated game state)
- Added SVG interior detail layers: meeting-room glass, raised flooring/walls, pixel desks/keyboards/mugs, chairs, houseplants, sofa, bookshelf, art, warm lighting and decorated storage. Internal SVG only, no external assets, login, or credentials.
- Enlarged scene typography and premium dark UI accents across mobile, tablet and desktop.
- Current P3 Lab is still **not an original Habblaud integration**, not a production page, and needs PM side-by-side visual review against the user-approved reference as well as Safari and Chromium screenshots.

## Iteration 3.1 — Camera and viewport completion
- Added opt-in **immersive full-scene mode** without removing the standard dashboard; pressing again returns rewards and shops.
- Added rest/work/meeting quick-focus navigation so mobile users can get to rooms while keeping character scale readable; compliant with reduced-motion preferences.
- Four-frame Chromium local rendering QA for prior full scene: mobile portrait 390x844, landscape 844x390, desktop landscape 1440x900, desktop portrait 900x1200; no JavaScript page errors. Updated immersive controls still need fresh retest. No claim of real iPhone Safari pass.

## Iteration 4 — Real pixel sprites (not live jobs)
Includes self-contained `sprites.js` with PM, Co, Gem, and pixel-cat shapes, animated walk/work/meeting/rest visual cues, brighter details and larger desktop camera. State cue labels remain showcase-only, unrelated to any actual TaskFlow dispatch.
