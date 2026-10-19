# P3 Pixel Office — Native Integration QA Handoff

Date: 2026-10-19 (UTC)

## Candidate identity and boundary

- Candidate: `0.9.0-alpha.9.78` (review candidate; Build is generated after the source commit and recorded in the final identity commit).
- Base: P2 main `a9db9b2fe3051e22d59e52ad083c8d54d12dba62` (`0.9.0-alpha.9.76`, Build `20261018-1932`).
- This is an isolated review candidate. It does not change `main`, Pages, Render, Production DB/Auth, or Native Lab.
- Frozen `third_party/multica/` is unchanged. Habblaud is fetched into a temporary build checkout at pinned MIT source commit `faa1a012b5fbf632c66dc6801c5383e53a542406`; the resulting preview bundle and its license are included under `native/`.
- The exact GitHub review branch head is the source identity for this document; this file intentionally does not embed a self-referential commit SHA.

## Architecture decision

Use the existing P2 Habblaud Canvas and interaction engine as the only office scene authority. The candidate retains its canvas, characters, room assembly, walk grid, furniture renderer, interaction spots, and camera. P3 adds a small native room-layout overlay and Gem's accessible people shell; it does not retain PR #65's second SVG office engine.

- From PR #65, adopt the seven-role display, people/activity panel and person-detail interaction, while keeping agent activity unknown unless fresh, source-linked evidence exists.
- Do not adopt PR #65's local `+500` wallet/shop as an authority or its separate scene engine.
- PR #64's verified-event/idempotency reward concept remains a future constraint for any separately approved reward work. This layout candidate creates no second wallet and does not modify the P2 reward authority.
- Betty, 安安 and 卡卡 are fictional `resident` characters. Their animations are not real-person location or work evidence. Agent states without current verified evidence display as unavailable/unknown.
- GitHub activity is anonymous, read-only and repository-wide; it is not attributed to a person. TaskFlow is explicitly `not connected`; the preview makes no TaskFlow, Supabase or Render calls and bypasses no access gate.
- Existing TaskFlow, WorkLog, Investment, Lab and Classic entrances remain. No unverified AI cockpit or TF-03 URL is invented.

## Space and viewport review

The single connected floor has an indoor reception award wall, engineering/tools area, enclosed meeting room with wall, doorway, table and four seats, plus lounge/reading space and connecting walkways. The upstream outdoor campus, trees and road remain visible around the office footprint; therefore the target is a connected indoor office layout, but a fully enclosed single-floor visual is only **PARTIAL**. Meeting-room lettering is close to its doorway, and some role labels are small at narrow desktop height.

Chromium viewport smoke was rerun after Gem’s desktop refinement and the native award/room interaction fixes:

| Viewport | Result | Notes |
|---|---|---|
| 1920×1080 | PASS | Full floor visible; main scene remains readable. |
| 1440×900 | PASS | Full floor and people panel usable. |
| 900×1200 | PASS, visual follow-up noted | Floor fills canvas; some labels are small. |
| 390×844 | PASS, smoke only | No crash or horizontal page overflow; mobile art refinement is deferred. |
| 844×390 | PASS, smoke only | No crash or horizontal page overflow; mobile art refinement is deferred. |

The final candidate produces `desktop-1920x1080-overview.png` and `desktop-1440x900-overview.png` at the requested desktop sizes. These are Chromium screenshots, not PM device acceptance. Real iPhone Safari is **NOT VERIFIED** and remains PM acceptance. The final GitHub Actions run uploads the viewport screenshots and built isolated preview as an artifact with 14-day retention. Local copies from the current review run are at `/workspace/artifacts/p3-native-final/`:

- `desktop-1920x1080-overview.png`
- `desktop-1440x900-overview.png`
- `desktop-narrow-900x1200-overview.png`
- `mobile-390x844-overview.png`
- `mobile-844x390-overview.png`

## QA evidence

- P3 evidence-contract, P2 office-contract, furnishing and P2 core tests: **25 passed, 0 failed** (`tests/pixel-office-personnel-evidence.test.cjs`, `tests/zhuge-pixel-office-contract.test.cjs`, `tests/zhuge-office-furnishings.test.cjs`, `tests/zhuge-office-p2.test.cjs`).
- P3 Chromium smoke: **PASS** across all five viewports above. Verified native Habblaud canvas, seven roles, shell/scene selection synchronization, resident-vs-agent behavior, localized native room labels, three medal clicks and fixed product links at 1920×1080, meeting room selection/focus, explicit TaskFlow disconnected state, no TaskFlow/Supabase/Render requests, no page errors and no horizontal page overflow.
- Original P2 Habblaud browser smoke: **PASS** for cast, role dossier, medal detail, P1 links, desktop/mobile, classic/docs.
- P3 layout smoke: **PASS** for seven roles, three P3 interior zones, P2 core preservation, indoor award sprites, meeting-room wall/door, corridor-to-room A* path through the real doorway, and furniture avoidance.
- Pinned upstream Habblaud TypeScript check: `tsc --noEmit -p tsconfig.json`, **PASS** (exit 0).
- Pinned upstream production client/server build: **PASS**, 214 modules; Vite reports its existing large-bundle advisory (~739 KB), not a build failure.
- Compiled native preview output compared with committed `native/` output using `diff -qr`: **PASS**, no differences.
- Full pinned-upstream Vitest rerun with `--no-file-parallelism --maxWorkers 1`: **1,879 passed, 2 skipped, 3 failed** across 158 files. The three failures are unrelated file-mode assertions in `server/test/statusline.test.ts` (2) and `server/test/hooks-install.test.ts` (1): this environment creates the atomically replaced settings files as `0600`, while those tests expect `0644`. Re-running those two files alone reproduced the same three failures (29 passed, 1 skipped). The P3 candidate does not change these upstream server installers, and Frozen Vendor is not modified. An earlier parallel full run had a 5-second art-test timeout; the exact `blocos de piso são opacos e determinísticos` test passed when rerun alone, and the serialized full run had no timeout.
- Repository browser regression (`BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:browser`): **PASS**, 25 browser test files, 16 standalone checks, 0 skipped, 0 page errors, 0 console errors, 0 provider CORS errors. Results include existing TaskFlow, WorkLog, navigation, Module C and SkyEye paths. Test-generated screenshots under `docs/qa/**/screenshots` and `tests/evidence` were restored and are not part of this candidate.
- `git diff --check`: **PASS** after the final source and documentation edits.
- No real iPhone Safari, authenticated Zhuge session, TaskFlow live connection, live actor movement into/out of the meeting room, public HTTPS preview, or production deployment was performed. The native A* path itself is tested, but that does not prove an animated character completes the route.

## Source ownership and release state

- Gem owns `p3-native-shell.html` and `p3-native-shell.css`.
- Co owns `integrations/habblaud/**`, `index.html`, evidence contract, tests, workflow, and this handoff.
- The review workflow is scoped to the isolated review branch/PR. It builds and tests review artifacts only; it does not deploy.
- P2 remains on the unchanged `.9.76` main. Close/abandon the review PR to roll back this candidate; no production rollback is required because it is not deployed.
- PM's next acceptance is desktop visual review first. Only after desktop layout approval should the mobile art/camera be refined. Real iPhone Safari acceptance remains pending.
