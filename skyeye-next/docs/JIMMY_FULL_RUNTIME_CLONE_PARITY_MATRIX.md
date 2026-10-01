# SkyEye Jimmy Full Runtime Clone — Desktop Parity Matrix

## Authority and candidate identity

- Runtime reference: <https://godeyes.jimmy-dev.win/>
- Upstream base: `bilawalsidhu/gods-eye-view`
- Frozen upstream commit: `b210ab0fe4d71c7faa0268134e0aa5f3c53fc7fe`
- Candidate Build: `20260929-1033`
- Candidate route: `/skyeye-next/jimmy/` (isolated full-screen sub-application)
- Evidence: `tests/evidence/skyeye-jimmy-full-runtime/`
- Candidate provider rule: do not call Jimmy `/api/*`; NLSC PHOTO2 and Zhuge's existing local adapters are used. Existing Taiwan provider foundation remains intact.

## Status vocabulary

`NOT_STARTED` · `PARTIAL` · `FUNCTIONAL_MATCH` · `VISUAL_MATCH` · `PARITY_PASS` · `BLOCKED`.
`PARITY_PASS` requires runtime behavior, visible presentation, interaction, and no blocking runtime error; HTTP 200 alone is not sufficient.

## Feature matrix

| Surface / capability | Reference evidence | Candidate evidence | Status | Remaining gap |
|---|---|---|---|---|
| Full-screen map shell | Direct desktop captures at 1440×900 and 1920×1080 | Browser QA confirms `/skyeye-next/jimmy/`, map viewport exactly fills each viewport, no horizontal overflow | `FUNCTIONAL_MATCH` | Header/panel geometry and information density still differ visibly. |
| Top application bar | Reference capture shows app identity, location search, live indicators, layer counts, refresh/fullscreen | Candidate has isolated top bar, existing search control, enabled-layer/camera counts, refresh and fullscreen; fullscreen enter/exit passed | `PARTIAL` | Search accepts input, but a successful place-geocode result has not been proven. |
| Operational toolbar | Reference toolbar and operational actions visible | Candidate mounts existing map actions in a bounded toolbar; browser bounds check passes at both desktop sizes | `PARTIAL` | Different action inventory and visual grouping. |
| HUD | Reference centered live HUD | Candidate shows view coordinates, basemap, enabled-layer count and CCTV point count; hide/show interaction passed | `FUNCTIONAL_MATCH` | Reference-specific status labels and compact visual treatment differ. |
| NLSC photo basemap | Reference uses Taiwan aerial/photo map | Candidate activates the real NLSC PHOTO2 stack; Cesium reports imagery loaded in the 1920×1080 capture | `FUNCTIONAL_MATCH` | Tile service intermittently returns HTTP 503; 1440 capture can occur while tile state is still settling. |
| CCTV catalog / map points | Reference shows Taiwan camera catalog and many visible targets | Existing CCTV adapter is enabled; browser evidence reports a bounded 30-record QA catalog and a real selected New Taipei camera | `FUNCTIONAL_MATCH` | Candidate does not reproduce the reference's eight-window camera wall. QA's 30-source cap is local test configuration only. |
| CCTV floating window | Reference has multiple camera windows | Candidate opens one real selected-camera floating monitor | `PARTIAL` | Multi-window layout/management is not implemented. |
| CCTV live media | Reference screenshots show live frames | Candidate requests the selected real camera frame; local read adapter returned HTTP 503 (`/api/cctv/frame/new-taipei-cctv-C000003`) and UI truthfully shows `FRAME_UNAVAILABLE` | `BLOCKED` | Provider/media endpoint availability must be resolved; no fabricated frame is used. |
| CCTV-to-map connector | Reference draws visible dashed connections from camera window(s) to map | Candidate computes a line from the selected camera's real coordinates; line is visible in runtime state and screenshot | `FUNCTIONAL_MATCH` | Only the single selected-camera connection is supported. |
| Right live information / weather / event panel | Reference contains a populated weather card and traffic/event feed | Candidate displays a bounded evidence summary for weather/radar, traffic/events and CCTV with loaded/not-loaded/count states | `PARTIAL` | Weather remains not loaded by default; candidate does not yet match the populated reference cards/feed. |
| Bottom layer controls | Reference bottom layer toolbar | Candidate exposes quick toggles and existing layer drawer; drawer open/close and active-state wiring tested | `PARTIAL` | Layer list and labels are not yet fully equivalent to reference. |
| Bottom coordinates/status | Reference coordinate, zoom, refresh and camera freshness state | Candidate reports center latitude/longitude, altitude, runtime clock and refresh result label | `PARTIAL` | Zoom/camera refresh cadence and reference-specific readouts differ. |
| Object selection | Reference selection shown in runtime recon | Candidate selects a real CCTV record on startup; unrelated aircraft/vessel selection not exercised in this gate | `PARTIAL` | Cross-domain selection parity needs a separate verified interaction pass. |
| Tracking | Reference aircraft/object tracking exists | Existing upstream tracking implementation remains in the application source | `NOT_STARTED` | No candidate-route runtime tracking interaction evidence in this pass. |
| Refresh / realtime state | Reference shows live/refresh indicators | Candidate refresh action calls the existing enabled-layer refresh path; state is exposed in status bar | `PARTIAL` | Provider cadence and refreshed-data visual proof not established for all domains. |
| Visual comparison | Direct reference captures at 1440×900 and 1920×1080 | Candidate captures at matching sizes plus labeled side-by-side composites | `PARTIAL` | First-glance full-product visual gap remains obvious; this is a review candidate, not parity acceptance. |

## Browser QA evidence

`qa-jimmy-runtime.mjs` exercises the real candidate route at 1440×900 and 1920×1080, waits for startup provider attempts, captures screenshots, and checks:

- exact viewport-sized map; route ready; upstream welcome hidden;
- PHOTO2 selected; clone HUD visible; unrelated upstream HUD hidden;
- native actions remain inside operation bar; no horizontal overflow;
- layer drawer open/close; intelligence panel close/reopen;
- display controls open/close; HUD hide/show;
- browser fullscreen enter/exit; search control present and accepts text.

The test records HTTP error status/host/path without query strings. CCTV frame 503 is retained as an observed provider failure and is not suppressed as a pass. The local Vite HMR websocket warning is separately tagged as a harness warning. This is a PASS for the tested route/layout/control interactions, not a full feature or parity PASS.

## Screenshot artifacts

| Viewport | Jimmy reference SHA-256 | Candidate SHA-256 | Labeled comparison SHA-256 |
|---|---|---|---|
| 1440×900 | `2372ebe9e73ac7b5f89e1de2f3733f1d5e9379c9864f5fe37ca42ff844d948b8` | `8091e4f4a433ddcc87887fe36918cbc635646c666a7a64cdac6a76132eede405` | `a0eabcea79fe360ed481cf6ecddba578e85b06b40bf9e3c7b1f25883bc726f3e` |
| 1920×1080 | `70f680cb3de1d7b8e29142753584b36f184dad9b0c3dbe0255d574e80a20034e` | `4dd59dd543a2ff766a492e12a6b7db504e351e365b771cb8808e1467d870d340` | `636990d974a4c14c05e81c626d552bf6f0b8a2b66d2d01f0614bbbf4529c6243` |

Files: `reference-1440x900.png`, `candidate-1440x900.png`, `comparison-1440x900.png`; likewise for `1920x1080`. Reference is an actual direct browser capture of the public runtime; candidate is an actual local Browser Runtime capture using real provider responses. No fixture image is used in either comparison.

## Source and use boundary

- God’s Eye View remains the MIT upstream base; this clone route is kept separate from the existing SkyEye route and its shell.
- Jimmy's runtime is used as visual/behavioral evidence only; no Jimmy compiled code or private asset was copied.
- Candidate does not depend on `godeyes.jimmy-dev.win/api/*`.
- Existing NLSC/CWA/CCTV/Freeway/CMS/Reservoir/Marine provider work remains in place; this candidate only activates existing read paths needed for its initial view.
- Current production SkyEye is not replaced, deployed, or published by this local candidate.

## Gate result

**Candidate for PM Desktop Review: PARTIAL.** The isolated experience boots and exposes the major layout regions and selected interactions, but this evidence does not support `SKYEYE JIMMY FULL RUNTIME PASS`. The clearest unresolved gaps are live CCTV media (503), multi-window parity, populated weather/event presentation, successful geocoding, tracking proof, and visible layout fidelity.
