# P3 Pixel Office — Personnel Panel Candidate QA

**Status:** isolated P3 candidate / Draft PR #65 / no main push / no Production deployment.

## Source identity

- Product baseline: `0.9.0-alpha.9.76`.
- Candidate Build: `20261019-0651` (generated and synchronized through `release-governance.js`).
- Official base: `main` `a9db9b2fe3051e22d59e52ad083c8d54d12dba62` (`0.9.0-alpha.9.76`).
- Review branch: `review/pixel-office-p3-isolated-20261018`; use the PR's current head SHA as the source identity.
- Frozen Multica, Native Lab, formal homepage behavior, database, and Production configuration are unchanged. Build synchronization changed 23 Version/Build/cache identity projections; it did not add feature changes to those modules.

## Delivered

- Added GPT and three distinct virtual residents (Betty, 安安, 卡卡), with `resident` separated from `agent` and PM `operator` roles.
- Added a desktop collapsible personnel sidebar and mobile bottom drawer. Scene characters, roster rows, and detail cards select the same role.
- Agent status uses only short-lived explicit handoff records. Each record includes source, update time, reference, freshness, expiry, and a link. Expired evidence cannot set current status; absent/expired evidence displays `尚無可驗證的最新狀態`.
- Residents have labelled virtual activity only; no real-person location or work tracking.
- GitHub PR #65 timeline is public/read-only and unattributed. Live unauthenticated GitHub REST requests are cached for five minutes. If egress is unavailable, the UI uses the clearly labelled snapshot `personnel-github-snapshot.json`, verified at `2026-10-18T22:35:43Z` and pinned to then-current PR head `23dca6b0908a911b3693d40dbfe353c692562198`. Snapshot links point to the real PR, commit, and comment records; it is historical, not live.
- TaskFlow is explicitly `尚未連線`. This candidate does not probe or bypass a TaskFlow read gate.
- Renamed the preview's bottom navigation class to `p3-office-nav` so the isolated page does not collide with the shared Functional Tabs CSS guard.

## QA evidence

- Final targeted Node tests: `node --test tests/functional-tabs.test.js tests/pixel-office-personnel-evidence.test.cjs` — **12 passed, 0 failed**.
- `node --check` on page scripts and browser test — **PASS**.
- `git diff --check` — **PASS**.
- Playwright Chromium browser QA — **4/4 viewports passed**: 390×844, 844×390, 1440×900, 900×1200. Checked seven roles/sprites, scene size, roster/detail selection, virtual-resident disclosure, sidebar/drawer interaction, source/freshness labels, and no page-level horizontal overflow. The browser test returns 503 for public GitHub API requests to exercise the honest static-snapshot fallback; it verifies no TaskFlow, Supabase, or Render request.
- Browser viewports are Chromium form factors, **not** physical iPhone Safari. PM's real iPhone Safari review remains **NOT VERIFIED**.
- GitHub API live browser access from this environment is unavailable through the execution tunnel. The public REST path has unit coverage, and the browser verified the timestamped static fallback; live browser/API connectivity is **NOT VERIFIED**.
- Full repository Node regression was run on the prior synchronized Build `20261019-0637`: **971 tests, 965 passed, 6 failed**. One failure was the P3 navigation class collision described above and is now resolved by the final targeted Functional Tabs pass. The other five are outside P3 and remain unresolved/unverified: legacy root-home assertions conflict with the current `.9.76` Pixel home; the Pages artifact test needs the workflow's pinned Pixel Office assembly and was not invoked with that completed artifact; the TaskFlow Pages feasibility test expects an older readiness label. Full repository regression is therefore **FAIL**, not PASS, and is not a P3 acceptance claim.
- A local curated Pages artifact build omitted `pixel-office/index.html` because the workflow's pinned upstream assembly step was not run; Pages publish artifact validation is **NOT VERIFIED**. This P3 candidate does not change the Pages publishing workflow.
- No Production/TaskFlow runtime or physical-device test was performed.

Local screenshots from final Chromium run:

- Desktop landscape: `/workspace/artifacts/p3-personnel-qa/final/desktop-landscape-panel.png`
- Mobile portrait: `/workspace/artifacts/p3-personnel-qa/final/phone-portrait-panel.png`
- Mobile landscape: `/workspace/artifacts/p3-personnel-qa/final/phone-landscape-panel.png`
- Desktop narrow/portrait: `/workspace/artifacts/p3-personnel-qa/final/desktop-narrow-portrait-panel.png`

These are local QA artifacts. The P3 GitHub Actions workflow uploads equivalent viewport screenshots to a seven-day PR artifact after the review branch is pushed.

## Handoff and limits

- Co's active integration handoff was recorded at `2026-10-18T22:50:37Z`, expires at `2026-10-18T23:20:37Z`, and links to PR #65. After expiry the UI must stop showing it as current.
- Gem's frontend delivery is recorded as completed at `2026-10-18T22:36:47Z`, with the same timestamped PR reference and short expiry. After expiry it remains historical evidence only.
- PM and GPT have no current verified work event in the approved sources; their status remains unknown.
- The pinned GitHub snapshot is historical and labels its verification time and source head; live API data replaces it when reachable.
- P3 does not connect to TaskFlow, assign tasks, report real-time provider presence, or represent animations as work activity.
- PM still needs the test URL on a real iPhone Safari for final mobile acceptance. Production Pixel Office integration is not included or authorized by this candidate.
