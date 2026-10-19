# Pixel Office P2 #72 — WalkGrid candidate review

## Candidate identity

- Version / Build: `0.9.0-alpha.9.82` / `20261019-1520`
- Branch: `review/p2-issue-72-walkgrid-20261019`
- Parent candidate: #71 Draft PR #83, `842411c6eac6831c3f9988473f84b746d9f6211f`
- Formal baseline: `.9.76`, `a9db9b2fe3051e22d59e52ad083c8d54d12dba62`
- Pinned Habblaud source used for build/tests: `faa1a012b5fbf632c66dc6801c5383e53a542406` (MIT)
- Frozen Habblaud vendor and `third_party/multica` source are unchanged.

## Native geometry readback and PR #84

Draft PR #84 (`5fd2c7d84a65e0378c4210da1782692f522cc031`) labels every proposed X/Y coordinate and doorway dimension as `UNVERIFIED_LAYOUT_PROPOSAL`. None of those proposal coordinates are applied here.

The candidate uses the native assembled building `WalkGrid` and A* route finder. The existing #71 meeting room is enclosed by blocked wall tiles, has a two-tile walkable opening, and has blocked table tiles. A read-back route from the native corridor into the room crosses a walkable door tile; every route tile is checked against the actual grid. This validates the existing native room geometry and does not validate PR #84's proposed layout coordinates.

| Capability | Existing native basis | Candidate change / evidence |
| --- | --- | --- |
| Walkable / blocked tiles | Habblaud `WalkGrid` and building furniture footprints | Retained; simulation movement uses native grid and four-neighbor A*. |
| Wall / furniture collision | Native blocked cells | Targeted route test verifies every route tile is walkable and the furniture footprint remains blocked. |
| Meeting-room door | Native room wall/door assembly from #71 | Path test reaches the room interior through the two-tile walkable doorway without crossing its walls/table. |
| No legal path | Upstream `Sim.stepGo()` used to teleport to the goal when `findPath()` failed | TaskFlow-owned build overlay now clears reservations/queued plan, holds position, stands, and retries after a bounded pause. Unit test forces disconnected walkable regions and verifies no movement/teleport. |
| Idle character roaming | Native `Sim.planOuting()` chooses leisure destinations | Real Chromium browser smoke invokes the native debug outing trigger, observes at least one stable cast character move, and checks all cast positions remain on walkable cells with status/mode still `idle`. This is simulated idle movement, not evidence of engineering work. |
| Indoor/outdoor | Office `Sim` and CityScene are separate native scenes | Local visitor/city paths are distinct from the fixed office cast. There is no shared identity/transfer contract for an office character to continue into the outdoor CityScene. Continuous cast indoor/outdoor roaming is **BLOCKED / NOT IMPLEMENTED**; city navigation must not be presented as that evidence. |
| Residents / pets | No approved non-agent resident/pet identity contract in #70 | Family members and cats are not injected as provider agents or fictional engineering workers. They remain outside this #72 candidate pending a native non-agent entity contract; P3 pet gameplay remains HOLD. |

## QA evidence

- Habblaud Vitest targeted suite: 7 files, 80 tests PASS on the pinned source plus TaskFlow overlay.
- Habblaud TypeScript client check: PASS.
- TaskFlow-owned Pixel Office / furnishings / role-authority Node contracts: 15/15 PASS.
- Release identity and packaging governance tests: 50/50 PASS; classic status and Docs entry Build/cache identities are checked and synchronized with the root Build.
- Bridge authority test: PASS; fixed cast stays idle and static GitHub/project information does not create people or work state.
- Chromium browser smoke on a freshly built static Pages artifact: PASS using the installed Chromium 1193 binary. It verifies native canvas, actual idle roaming, valid WalkGrid positions, desktop/mobile-emulated interactions, #71 room/award behavior, and the docs route. Viewport checks include 1440×900, 1920×1080, and 390×844. Playwright's pinned Chromium 1248 download returned HTTP 403 in this environment; the exact-SHA GitHub workflow remains the clean-run check.
- Browser viewport is Chromium emulation, not physical iPhone Safari. iPhone Safari remains NOT VERIFIED.
- `git diff --check`: PASS.
- The exact-SHA GitHub Review workflow and FullSource gate are required on the remote candidate commit; until those runs complete, remote CI / FullSource status is **PENDING**, not PASS.

## Rollback and release status

This is a review-only candidate. Rollback is to close/abandon this candidate branch and retain the parent #71 candidate; no main, Production, Pages, Render, Database, Auth, or Secrets change was made. No database migration is included.

Continuous native agent roaming across the building boundary, resident/pet identities, real phone Safari, PM visual acceptance, and exact-SHA remote CI remain open gates.
