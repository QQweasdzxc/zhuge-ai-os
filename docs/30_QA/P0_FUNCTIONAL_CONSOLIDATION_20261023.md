# P0 Functional Consolidation .9.175 — Source-Only Review

Timestamp: 2026-10-23 Asia/Taipei. Build `20261023-2212`. Starting point: PR #128 (`.9.174`, SHA `1c4a7ae75d74c4975319a49ad8664bc7f2057fc9`) on top of main `.9.164`.

## Source lineage
- #128: retain native AI Sidebar, Project mapping and AI Issue readback, their overlay and isolated PostgreSQL 16 runtime tests.
- #126: selectively import fail-closed Go Provider dispatcher/route/claim types, approved SQL candidates (not installed), Agent Reporting, protected detail-store boundary, native Project mapping contract, Phase 2 Pages workbench source, and isolated tests. Integrate with #128 via one consolidated Dockerfile and combined exact-head CI. Legacy shared navigation, Pixel Office or Web/Pages artifacts from #126 are NOT overwritten.
- #52 / #55: retain Cloud Handoff protocol source and original test suite under `labs/cloud-handoff/`. It remains isolated and not connected to live Provider, TaskFlow native persistence, or an automatic paid executor.
- #48: preserve October 13 planning documents in the historical archive, not as current release/runtime authority.

## Current gates (do not claim PASS without same-SHA evidence)
1. Exact-SHA TaskFlow Build Parity, Backend Go/Web Docker, Browser Regression, Native PostgreSQL AI readback, Native Dispatch/Issue42 isolation and Cloud Handoff contracts: **PENDING**.
2. Native Render authoritative database, current Workspace and server-confirmed Agent/Project/ACL mappings: **UNVERIFIED (previous live mapping 0/5)**.
3. Official Codex/Gem Provider route, verified ACK/Run/STOP and durable transactional native write: **NOT CONNECTED / BLOCKED**.
4. Issue #42 SQL approved source exists, but Production install / one-Canary validation: **NOT EXECUTED**; stale #124 SHA-pinned workflow must never be triggered as-is.
5. #50 attachment lifecycle remains separate review candidate; storage/permissions/migrations NOT PROD-ACCEPTED.
6. #60's 591–598 migration/Provider callback remains an older, unmerged review candidate. Do not stage/deploy it blindly on top of native dispatch authority.
7. Release Governance preflight, FullSource/Manifest/SHA256, owner-only durable archive, production deploy SHA/readback and PM UAT: **NOT VERIFIED**.

## Authority
TaskFlow native Issue/Project and server Workspace ACL remain SSOT. No new Kanban, second database, direct client grants, autodeploy, credentials, paid provider or Production mutation. This is a **single code review candidate**, not full product integration or successful release.

## Remaining PR scope
Review the explicit outstanding source: #50 attachments, #60 real Cloud Handoff, #124 protected install workflow, #126 retained history, #128 native AI source. Continue retiring obsolete drafts only after proof of acceptance and replacement. Do not set the denominator to zero by merely closing Draft PRs.

## Attachment lifecycle #50 source preservation and safety correction
- Bring the distinct #50 `labs/attachments/`, TaskFlow storage/ACL candidate Go/SQL, isolated Edge candidate and tests to this single Review **as dormant source, not deployed/wired**.
- Correct `attachment_lifecycle.board_is_complete`: a completion-step only counts when the step and Board task share the same `workflow_version_id`. No unrelated Workflow can start the 72-hour deletion timer.
- Board trigger listens for `workflow_version_id` changes and invalidates or restarts the old deletion timer; staged PGlite test exercises foreign completion step and version reassignment.
- Require real Storage TUS/RLS, retention/bucket/permission E2E, release preflight/backup and separate PM acceptance before enabling any irreversible cleanup. Never copy the old #50 branch's global version/nav files or blindly apply Supabase SQL/cron.
