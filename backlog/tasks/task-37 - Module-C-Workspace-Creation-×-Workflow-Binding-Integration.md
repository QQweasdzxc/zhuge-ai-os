---
id: TASK-37
title: Module C Workspace Creation × Workflow Binding Integration
status: In Progress
assignee:
  - '@codex'
created_date: '2026-10-02 16:42'
updated_date: '2026-10-03 06:07'
labels: []
dependencies: []
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PM authorized Source and Developer QA only following read-only RCA. Published AI Board custom workspaces cannot create TASK because Workspace creation never integrates Workflow binding. Existing-workspace scope is only 資源分享與參考 and 暫緩; TASK-081 is excluded. No Cloud mutation, push, deploy, new RPC or migration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Configured Workflow workspace creation uses existing saveDraft, validateDraft and publish with explicit user confirmation and exactly-one binding read-back.
- [x] #2 Only the two authorized existing AI Board workspaces expose binding integration; TASK-081 is untouched.
- [x] #3 Existing steps, transitions, gates, evidence and cards are preserved; failures report partial progress and avoid duplicate workspace creation.
- [x] #4 WorkTodo, GAS and C Mother optional Workflow behavior and exactly-one create guard remain intact.
- [x] #5 Source, targeted and full regression QA are recorded truthfully; stop before Cloud mutation, push or deploy.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Integrate the shared Instance Service using existing Workflow capability, preserve version contracts and fail closed on draft/conflict. 2. Add explicit binding controls to shared Workspace UI and restrict existing AI Board remediation to the two authorized keys. 3. Exercise authority sequence, failure recovery and all adopters with mock/unit and localhost browser QA. 4. Run regression/preflight, record Source-only evidence and HARD STOP.

TASK-37 re-release: synchronize a new canonical Candidate Build ID using Release Governance; run required QA gates; create local release commit and FullSource Candidate with manifest/SHA; verify Build identity and artifact; no push, deploy, Cloud/Supabase mutation, or Workflow publish.

Release Baseline Recovery: extend existing browser-executable test support with loopback HTTP fixture transport and owned Chromium cleanup; migrate legacy file URL tests without changing assertions; verify all 11 readbacks, official browser authority, full regression and clean-commit release preflight. No Candidate ZIP or remote mutation.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented shared Instance Service integration with explicit role/status/publish confirmation, canonical saveDraft -> validateDraft -> publish -> exact-one read-back, immutable Published lineage checks, draft conflict checks, and in-session partial/uncertain creation recovery. Existing AI Board operation allowlist contains only 資源分享與參考 and 暫緩 keys; TASK-081 has no binding operation. Optional Workflow remains optional. No RPC/schema/migration/source guard changes; all QA uses local/in-memory fixtures. Source stop gate remains in effect.

Source Developer QA complete: targeted 98/98 PASS; localhost Chromium 8/8 PASS; final full regression 821 PASS / 11 FAIL / 0 SKIP. The same 11 failed test names were reproduced against unchanged HEAD in a separate baseline directory; all are existing Cloud browser environment checks. npm browser regression was BLOCKED by file URL fixtures and a leaked IVTK Chromium child; the task-owned runner/browser processes were terminated. JS syntax, git diff --check and source identity PASS. Formal release preflight remains blocked by uncommitted source. See docs/qa/module-c-workspace-workflow-binding/DEVELOPER_QA.md and developer-qa.json. Existing saveDraft absence-CAS race is documented; future Runtime QA must exclude concurrent Workflow editors. No commit, push, deploy or Cloud mutation. HARD STOP; retain In Progress until separate review/runtime gates.

Subsequent PM authorization: verify exact before/after failure-name equality, create one local commit only, and export that commit as FullSource ZIP with manifest and SHA-256. No push, deploy or formal Workflow binding mutation. Existing Candidate packager requires full=PASS, so the authorized artifact is a clearly labeled local-commit source snapshot using the existing file filters/source-manifest/archive-validation helpers; full regression remains 821 PASS / 11 baseline-matching FAIL. Previous uncommitted/stop notes describe the earlier QA snapshot. Review/runtime gates remain pending.

TASK-37 Re-Release QA, Candidate Build 20261003-1223: Release identity/preflight PASS; targeted 67/67 PASS including nine Module C localhost Chromium cases. Full Regression 832 total, 821 pass, 11 fail, 0 skipped; the failure-name set exactly matches the recorded unchanged-HEAD Cloud baseline in docs/qa/module-c-workspace-workflow-binding/developer-qa.json. Browser Regression BLOCKED when the IVTK file:// case hung with two Chromium children; task-owned runner and children were terminated and no live Chromium process remained. Migration retained and not applied. No Cloud mutation, Workflow publish, push, or deploy. Candidate packaging remains this task’s local step; GPT Review and PM push authorization remain pending.

Release gate disposition: The repository QA guidance states the 11 unchanged-HEAD baseline failures must remain FAIL and that the Candidate packager requires Full Regression PASS. The commit-state run reproduced all 11 names (832 total, 821 pass, 11 fail), but the raw command exit was 1; therefore no formal Candidate is deliverable. A temporary Candidate ZIP/Manifest/SHA created during packaging verification was removed. Browser Regression remains BLOCKED by the Cloud file:// limitation and IVTK runner hang. Keep this task In Progress for GPT/PM decision; no push, deploy, Cloud mutation, migration apply, or Workflow publish.

Release Baseline Recovery: all 11 prior failures diagnosed TEST_INFRA; repaired existing browser-executable transport and DOM driver using localhost HTTP and pinned Playwright, preserving all existing assertions. Targeted 18/18, Module C/helper/release checks 60/60, Full Regression 834/834 (0 fail/skip), official npm browser authority 29/29 plus all five standalone PASS. Installed pinned dependencies via npm ci for ESM resolution. No product behavior, schema/RPC, Cloud, publish, push or deploy changes. New Candidate Build synchronization follows only after these green gates; no ZIP this round. GPT/CTO review pending.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented Module C shared Workspace creation and scoped existing AI Board binding integration using the existing Workflow authority. Source and Developer QA gate reached with 98 targeted and 8 localhost browser checks passing; full-suite 11 environment failures match unchanged HEAD. The two live binding gaps remain unchanged. Stop before GPT/runtime acceptance or any remote mutation.
<!-- SECTION:FINAL_SUMMARY:END -->
