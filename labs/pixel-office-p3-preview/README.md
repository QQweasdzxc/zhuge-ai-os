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

## P2/P3 feature disposition

| Area | Decision | Evidence / boundary |
|---|---|---|
| P2 Habblaud Canvas, rooms, characters, doors, walk grid, furniture, camera and original interaction engine | **KEEP** | Remains the only scene engine; P2 smoke passes for cast/profile, decision panel, medals, navigation, desktop/mobile, Classic and docs.
| P2 wallet/reward authority and native coin mechanics | **KEEP** | No second P3 wallet is introduced. P3 does not change the pinned Habblaud reward/simulation code.
| P3 seven roles, evidence-backed personnel panel, role details and resident/agent separation | **KEEP** | Included in the isolated shell. Without verified evidence, engineer status remains unknown; resident animation is fictional only.
| P3 indoor medal wall and product links | **KEEP** | Native Habblaud poster sprites are clickable and resolve only to the existing TaskFlow, WorkLog and Investment routes.
| Meeting room, lounge, engineering/tools room and shared walk grid | **KEEP** | Layout and corridor A* doorway route are tested; physical actor movement is not claimed.
| PR #64 reward-event idempotency proposal | **DEFER** | Revisit only if a separately approved reward integration uses one authoritative reward path.
| PR #65 standalone SVG office engine, local +500 wallet/shop, pet-shop economy and black-cat/pet subsystem | **DEFER** | Not merged into the Habblaud engine. The P3 changes do not alter these; P2 source-level reward logic is retained, but black-cat/pet gameplay is not verified by this candidate's browser regression.
| Full enclosed single-floor appearance with exterior/campus removed | **DEFER / PARTIAL** | Habblaud's outdoor campus remains around its native building footprint. Current interior zones are connected but the target fully enclosed look is not complete.
| Live TaskFlow event feed and authenticated personnel status | **MISSING / NOT CONNECTED** | No TaskFlow, Supabase or Render requests are made by this isolated preview.
| Agent physically entering/exiting the meeting room in live simulation | **NOT VERIFIED** | Native pathfinder reaches the room through the door while avoiding blocked furniture; actor movement through the route has not been observed in browser.
| Real iPhone Safari and public HTTPS preview | **NOT VERIFIED / BLOCKED** | Chromium viewports pass; no live HTTPS preview host is authorized or configured.

## Source ownership and runtime contract

- Co owns the Habblaud adapter, room geometry, build patch, evidence contract, and regression gates under `integrations/habblaud/`.
- Gem owns `p3-native-shell.html` and `p3-native-shell.css` in this lab. The shell and native scene communicate through same-origin, source-checked messages: `p3-native-shell:ready`, `p3-native-shell:scene-src`, `p3:select-agent`, and `p3:agent-selected`.
- P3 layout and display data are applied only to a temporary checkout of the pinned upstream during build. No file under `third_party/multica/` or the P2 Habblaud source is edited.
- Existing app navigation URLs are validated against the current project route manifest. AI cockpit and TF-03 URLs remain absent until a real route is provided.
- The isolated preview can be opened with `?pr=<actual-integration-pr-number>` to show that PR's public GitHub events. Alternatively set `P3_CONFIG.pullRequestNumber`. Without either, the loader does not guess a PR number or show another PR's snapshot. GitHub requests are anonymous/read-only and never attribute repository events to an engineer.

## QA status

The current QA run is defined by the candidate's `integrations/habblaud/p3-layout-smoke.mjs`, `integrations/habblaud/p3-browser-smoke.mjs`, the unchanged P2 Habblaud smoke, evidence contract tests, pinned upstream typecheck/build, and workflow artifact. Results are recorded in `QA_NATIVE_INTEGRATION.md` after the candidate is frozen. Desktop Chromium at 1920×1080, 1440×900, and 900×1200 is the primary target; mobile Chromium checks are no-crash/layout smoke only. Real iPhone Safari is a PM acceptance item, never inferred from Chromium emulation.

The review workflow uploads its screenshots and built isolated preview as a GitHub Actions artifact retained for 14 days. There is no live HTTPS preview URL yet: the workflow intentionally does not deploy, and no isolated preview host has been authorized/configured. The candidate must not be presented as publicly deployed.

## Review / release boundary

- Base is the official P2 `.9.76` main SHA `a9db9b2fe3051e22d59e52ad083c8d54d12dba62`.
- This branch and preview are isolated. No main merge, Pages publication, Render deployment, database, Auth, or production setting is changed by this candidate.
- The preview is served from the exact public review commit only after that commit and its compiled `native/` asset are pushed. It is not the official Zhuge origin or a production release. The canvas still shows Habblaud's native campus/outdoor surroundings around the office footprint; the P3 overlay changes rooms and interior furniture without replacing the upstream renderer.
- P2 may be restored by closing this review PR or checking out the unchanged main SHA; no production rollback is required because this candidate is not deployed.
