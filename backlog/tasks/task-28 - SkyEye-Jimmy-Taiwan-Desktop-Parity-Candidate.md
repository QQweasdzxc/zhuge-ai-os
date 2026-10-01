---
id: TASK-28
title: SkyEye Taiwan Provider Foundation
status: In Progress
assignee:
  - '@Co'
created_date: '2026-09-27 16:00'
updated_date: '2026-09-29 00:45'
labels: []
dependencies: []
references:
  - TASK-29
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Retain and verify the Taiwan data-provider foundation accumulated in the former Jimmy parity branch. This scope covers provider contracts, adapters, attribution and truthful provider availability evidence only. It is not the Jimmy Taiwan desktop runtime/parity candidate. The separate TASK-29 owns the full-screen Jimmy Runtime Clone Candidate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Taiwan provider contracts, adapters, caches and attribution registry remain available in the source tree.
- [ ] #2 Provider tests and browser evidence preserve source/as-of/freshness and explicit unavailable/not-configured states without fabricated payloads.
- [ ] #3 No production dependency calls godeyes.jimmy-dev.win/api/*.
- [ ] #4 The work is clearly identified as Taiwan Provider Foundation and makes no Jimmy visual/interaction parity claim.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Freeze Jimmy runtime recon and upstream baseline evidence into JIMMY_PARITY_MATRIX.md, API compatibility matrix, provider/license mapping, and screenshot capture contract; keep godeyes.jimmy-dev.win/api/* reference-only. 2. Add isolated Taiwan provider contract, registry, cache/coalescing policy, attribution registry, and provider adapters for the confirmed NLSC/CWA/Taiwan CCTV boundaries with explicit unknown/blocked states. 3. Integrate the first real E2E spike through the existing God’s Eye map/layer architecture by adding an opt-in NLSC WMTS map stack; preserve upstream defaults and current SkyEye routes. 4. Add deterministic contract/provider tests plus a real public NLSC WMTS probe and runtime evidence capture; exercise the frozen reference and candidate Desktop surfaces without production deployment. 5. Run targeted tests, upstream unit/regression gates, diff checks, and record source/runtime risks before Candidate review.
<!-- SECTION:PLAN:END -->
