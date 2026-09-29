---
id: TASK-29
title: SkyEye Jimmy Full Runtime Clone Candidate
status: In Progress
assignee:
  - '@Co'
created_date: '2026-09-29 00:45'
labels: []
dependencies: []
references:
  - 'https://godeyes.jimmy-dev.win/'
  - >-
    https://github.com/bilawalsidhu/gods-eye-view/tree/b210ab0fe4d71c7faa0268134e0aa5f3c53fc7fe
type: feature
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rebuild the publicly observable Jimmy Taiwan GodEyes desktop runtime as a full-screen SkyEye candidate. Jimmy runtime is the desktop experience authority; Zhuge shell provides only entry/auth/return. Reuse the frozen MIT God’s Eye View upstream baseline b210ab0fe4d71c7faa0268134e0aa5f3c53fc7fe and preserve all existing Taiwan provider foundation. Do not copy Jimmy compiled/proprietary assets or use its /api/* as a production dependency. Stop after a locally packaged candidate and await PM review; no push, PR, merge, deployment, publish, mobile work, or production cutover.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Full-screen route presents Jimmy-like application runtime independent of the Zhuge shell layout, with entry/auth/return boundary preserved.
- [ ] #2 Top app bar, search, operational toolbar, HUD, basemap, CCTV floating windows and map connectors, layer controls, weather/traffic/intelligence panels, bottom layer toolbar and status bar are implemented and interact coherently.
- [ ] #3 Object selection, tracking, refresh/realtime state, and fullscreen interactions work with available upstream and confirmed Taiwan providers; unavailable providers remain explicit.
- [ ] #4 Provide authentic Jimmy reference and candidate screenshot pairs at 1440x900 and 1920x1080, plus interaction/runtime evidence; no screenshot may misidentify its source.
- [ ] #5 Targeted and full regression pass, license/attribution and upstream provenance are documented, candidate has new build identity, FullSource ZIP, manifest, SHA256, and QA summary.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 No production deployment or external GitHub write occurred.
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reconcile the existing full MIT upstream application, current Taiwan Provider Foundation, and Jimmy desktop runtime evidence. 2. Create an isolated full-screen candidate surface reusing the frozen upstream application intact; define only an entry/auth/return bridge. 3. Integrate retained Taiwan providers into matching upstream surfaces without changing provider authority or relying on Jimmy /api/*; keep source-unknown features explicit. 4. Capture true 1440x900 and 1920x1080 reference/candidate comparisons and close desktop interaction gaps. 5. Run targeted and full regression, generate a new local Build identity and FullSource ZIP/manifest/SHA256/QA summary, then stop for PM review.
<!-- SECTION:PLAN:END -->
