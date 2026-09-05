---
id: TASK-12
title: Release Governance Remediation — Build Identity and Candidate Packaging Gates
status: Done
assignee:
  - '@Co'
created_date: '2026-08-26 07:10'
updated_date: '2026-08-26 07:19'
labels:
  - release-governance
  - packaging
dependencies: []
priority: high
type: chore
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
建立以 root version.json.build 為唯一 Build Identity 的 Pre-Packaging Gate、Post-Packaging Gate、Candidate Manifest 與正式版控交付流程。只處理 Release Governance，不修改產品功能、Checklist、Workspace、Cloud 或其他 Domain。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 root version.json.build 是唯一 BUILD_ID，所有 Runtime、Module、UI 與 cache-buster identity 必須一致
- [x] #2 ZIP filename 使用 BUILD_ID，不使用 packaging timestamp，並產生包含必要欄位的 Candidate Manifest
- [x] #3 Pre-Packaging 與 Post-Packaging Gate 會對錯誤 Build、cache-buster、module identity fail closed
- [x] #4 Temporary dist 與正式 PM 版控 Delivery 分離，正式交付前完成 ZIP integrity、Source↔ZIP、SHA-256 與 file count 驗證
- [x] #5 Governance targeted regression、Checklist targeted regression、Full Regression 與差異檢查通過
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. 建立以 root version.json.build 為唯一來源的 identity scanner 與 filename contract。 2. 建立 temporary packaging、Candidate Manifest、Pre/Post Gate 與 formal delivery adapter。 3. 新增 positive/negative governance regression，覆蓋 PM 核准的七種 Gate case。 4. 更新 Release / tools 文件，執行 targeted、Checklist、Full Regression 與 package verification。 5. 以 20260826-1209 建立全新 Candidate 並交付正式版控位置。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented tools/release-governance.js with root version.json.build identity scanning, symlink-safe source manifest, filename contract, Candidate Manifest sidecar, Pre/Post Packaging Gates, append-only formal delivery, and forbidden archive checks. Corrected the dashboard fallback version identity to 0.9.0-alpha.9.13. Added tests/release-governance.test.js; 7 governance gate cases plus release consistency pass. Updated docs/RELEASE.md and tools/README.md.

Final verification: Pre-Packaging PASS; Post-Packaging PASS; negative Gate cases 7/7 PASS; targeted Governance + Checklist 17/17 PASS; Full Regression 258/258 PASS; git diff --check PASS; formal ZIP unzip -t PASS; Source↔ZIP PASS; SHA-256 and 419-file count read back from formal 版控 location.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the approved Release Governance remediation only. Root version.json.build is the single Build Identity; runtime/module/UI/cache-buster scanning, fail-closed Pre/Post Packaging Gates, append-only formal delivery, sidecar Candidate Manifest, ZIP integrity, Source↔ZIP hash comparison, SHA-256, and file-count validation are now enforced. Produced and delivered the new Build 20260826-1209 Checklist Candidate to the formal PM 版控 directory. Governance 7/7, targeted 17/17, Full Regression 258/258, git diff --check, unzip -t, and formal delivery read-back all PASS.
<!-- SECTION:FINAL_SUMMARY:END -->
