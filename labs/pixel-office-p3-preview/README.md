# Pixel Office P3 — native Habblaud integration candidate

**Review only.** The single scene authority is the pinned Habblaud Canvas used by P2 (`faa1a012b5fbf632c66dc6801c5383e53a542406`). This candidate keeps the original P2 routes and interaction engine; the P3 route is an isolated composition of the same engine, a native-floorplan overlay, and Gem's accessible personnel shell.

## Spatial and feature decisions

- The office is one connected floor. The unchanged Habblaud core remains in place. Its reception layout is minimally replaced so the awards are wall furniture inside the lobby. Three P3 zones are native Habblaud rooms: engineering/tools, an enclosed meeting room with a door and four seats, and Lounge/reading. Habblaud still supplies the canvas, characters, room assembly, walk grid, furniture renderer, interaction spots, and camera.
- The P3 shell contains PM, Co, Gem, GPT, Betty, 安安, and 卡卡. Agent work state is unknown unless the existing time-bounded, source-linked handoff adapter supplies fresh evidence. GitHub events remain repository-wide and unattributed. The three resident characters only show fictional activities; their scene animations are not work or real-person location evidence. The roster uses a display-only snapshot with no TaskFlow task/status data.
- TaskFlow remains explicitly unconnected in this isolated candidate. P3 does not call TaskFlow, Supabase, or Render and does not bypass any access gate.
- The shell preserves verified entrances in new tabs: TaskFlow, WorkLog, Investment, Lab, and Classic AI Board. It does not invent AI cockpit or TF-03 download routes. URLs are aligned with the existing `assets/zhuge-office-furnishings.js` route contract.
- P2's existing reward/coin authority stays with P2. The local `+500` wallet and shop in PR #65 are not carried forward as an authoritative economy. PR #64's verified-event/idempotency idea is recorded as a future constraint if a single reward flow is later approved; this space-layout candidate does not add another wallet.
- PR #65's black-cat/pet shop is deferred: the pinned native character contract currently represents human sprites, and adding a second pet animation/economy subsystem would widen this room/layout change. Existing P2 functions and links remain unchanged.
- Older `app.js`, `sprites.js`, and `style.css` P3 standalone-engine files were removed from the active preview. `art/` and iteration QA notes are retained as reference/history, not runtime assets.

## Source ownership and runtime contract

- Co owns the Habblaud adapter, room geometry, build patch, evidence contract, and regression gates under `integrations/habblaud/`.
- Gem owns `p3-native-shell.html` and `p3-native-shell.css` in this lab. The shell and native scene communicate through same-origin, source-checked messages: `p3-native-shell:ready`, `p3-native-shell:scene-src`, `p3:select-agent`, and `p3:agent-selected`.
- P3 layout and display data are applied only to a temporary checkout of the pinned upstream during build. No file under `third_party/multica/` or the P2 Habblaud source is edited.
- Existing app navigation URLs are validated against the current project route manifest. AI cockpit and TF-03 URLs remain absent until a real route is provided.
- The isolated preview can be opened with `?pr=<actual-integration-pr-number>` to show that PR's public GitHub events. Alternatively set `P3_CONFIG.pullRequestNumber`. Without either, the loader does not guess a PR number or show another PR's snapshot. GitHub requests are anonymous/read-only and never attribute repository events to an engineer.

## QA status

The current QA run is defined by the candidate's `integrations/habblaud/p3-layout-smoke.mjs`, `integrations/habblaud/p3-browser-smoke.mjs`, the unchanged P2 Habblaud smoke, evidence contract tests, pinned upstream typecheck/build, and workflow artifact. Results are recorded in `QA_NATIVE_INTEGRATION.md` after the candidate is frozen. Desktop Chromium at 1920×1080, 1440×900, and 900×1200 is the primary target; mobile Chromium checks are no-crash/layout smoke only. Real iPhone Safari is a PM acceptance item, never inferred from Chromium emulation.

## Review / release boundary

- Base is the official P2 `.9.76` main SHA `a9db9b2fe3051e22d59e52ad083c8d54d12dba62`.
- This branch and preview are isolated. No main merge, Pages publication, Render deployment, database, Auth, or production setting is changed by this candidate.
- The preview is served from the exact public review commit only after that commit and its compiled `native/` asset are pushed. It is not the official Zhuge origin or a production release. The canvas still shows Habblaud's native campus/outdoor surroundings around the office footprint; the P3 overlay changes rooms and interior furniture without replacing the upstream renderer.
- P2 may be restored by closing this review PR or checking out the unchanged main SHA; no production rollback is required because this candidate is not deployed.
