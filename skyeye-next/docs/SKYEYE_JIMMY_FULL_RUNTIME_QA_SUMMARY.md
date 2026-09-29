# SkyEye Jimmy Full Runtime Clone — Candidate QA Summary

## Gate

**Candidate Ready for PM Desktop Review — PARITY PARTIAL.** This is not `SKYEYE JIMMY FULL RUNTIME PASS` and is not deployed.

- Build: `20260929-1033`
- Branch: `codex/skyeye-jimmy-full-runtime-clone-20260929`
- Frozen God’s Eye View baseline: `b210ab0fe4d71c7faa0268134e0aa5f3c53fc7fe`
- Candidate route: `/skyeye-next/jimmy/`
- Exact source commit: recorded by the FullSource Candidate manifest (`gitBaselineCommit`).
- Source boundary: Jimmy public runtime was used as visual/behavioral reference; no Jimmy compiled bundle or proprietary asset was copied, and Candidate code does not call Jimmy `/api/*`.
- External mutations: no push, PR, merge, deployment, publish, or Production cutover.

## Candidate Runtime QA

Local Browser Runtime: `http://127.0.0.1:4190/skyeye-next/jimmy/`.

| Check | Result | Evidence |
|---|---|---|
| Route HTTP + isolated runtime mount | PASS | HTTP 200; actual `jimmy-runtime-ready` and runtime instance observed |
| 1440×900 / 1920×1080 viewport | PASS | Full-viewport map at both sizes; no horizontal overflow |
| NLSC PHOTO2 basemap | PASS with provider caveat | Correct PHOTO2 layer active; Cesium imagery loaded; tile service may intermittently return 503 |
| Real Taiwan provider layers | PASS | 30-record CCTV catalog plus freeway live and CMS layers loaded from existing adapters; QA cap is local-only |
| Selected CCTV target + map connector | PASS | Real catalog record selected at 8.2 km from view center; selected-target connector is visible |
| Camera media | FAIL / provider unavailable | Actual frame request returned HTTP 503 and UI reports `FRAME_UNAVAILABLE`; no image fixture was substituted |
| Layer drawer, intelligence panel, display controls | PASS | Open/close interactions executed |
| HUD | PASS | Hide/show and `aria-pressed` state verified |
| Fullscreen | PASS | Enter and exit verified in Chromium |
| Search control | PARTIAL | Real control accepts text; successful place/geocoder result was not proven |
| Object selection | PARTIAL | CCTV selection is visible; cross-domain aircraft/vessel selection not verified |
| Tracking | NOT STARTED | No Candidate-route tracking interaction evidence |

The reference screenshot set shows eight camera windows and populated weather/event information. The Candidate has one camera window with unavailable media, a compact evidence/status panel, and no tracking proof. The visible experience is still materially different; the parity matrix retains these as gaps.

## Test Results

- Targeted tests: **16 PASS / 0 FAIL / 0 skipped**.
- SkyEye Next full unit regression: **5,084 PASS / 0 FAIL / 1 skipped**. The single skip is the allocation microbenchmark calibrated for Node 24 while this host runs Node 26.7.0.
- Candidate Browser Runtime QA: **PASS for tested route/layout/control interactions at both desktop viewports**; observed CCTV frame HTTP 503 remains a provider failure, not a QA-green result.
- Production build: **PASS**, 704 modules transformed. Bundler emitted a non-fatal large-chunk warning (>1,500 kB).
- Package boundary checks: **PASS**, 838 modules / 63 portable entries.
- `git diff --check`: **PASS**.
- Repository-wide Browser Regression: **NOT PASS / incomplete**. The generic authenticated Zhuge page tests encountered local runtime/fixture timeouts; the SkyEye mobile test could not resolve root `playwright`; the harness was stopped after 5 passed, 13 failed and 1 cancelled out of 19 reported tests. This suite is distinct from the passing isolated Jimmy-route Puppeteer QA above.

## Screenshot Evidence

All files are under `tests/evidence/skyeye-jimmy-full-runtime/`.

| Viewport | Reference | Candidate | Side-by-side comparison |
|---|---|---|---|
| 1440×900 | `reference-1440x900.png` | `candidate-1440x900.png` | `comparison-1440x900.png` |
| 1920×1080 | `reference-1920x1080.png` | `candidate-1920x1080.png` | `comparison-1920x1080.png` |

The SHA-256 values and direct-reference capture details are in `JIMMY_FULL_RUNTIME_CLONE_PARITY_MATRIX.md` and `runtime-evidence.json`.

## PM Review Focus

The PM can evaluate overall layout direction in the comparison images. The Candidate is not suitable to accept as a full parity clone until the live camera media path, multi-camera wall, populated weather/event panel, successful geocoding, object tracking, and remaining visual/interaction gaps are resolved or explicitly accepted.
