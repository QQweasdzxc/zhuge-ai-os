---
id: TASK-8
title: ONE Golden Master — Single Presentation Source of Truth Governance Principle
status: In Progress
assignee:
  - '@codex'
created_date: '2026-08-21 14:39'
updated_date: '2026-08-21 15:08'
labels:
  - governance
  - architecture
  - golden-master
  - docs
dependencies: []
priority: high
type: docs
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
正式寫入 PM／CTO 已確認的 ONE Golden Master — Single Presentation Source of Truth Mandatory Architecture Principle。先 Audit 正式 Principle Registry、AI_RULEBOOK、Architecture／Engineering／Governance／ADR 文件與既有編號體系；確認衝突與 Golden Master Conformance；完成治理文件與必要 cross-reference 更新。禁止本任務修改 Product Presentation、Cloud、Schema、RPC、RLS、Migration 或 Consumer Source。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 找出正式 Principle Registry 與合法編號規則，並回報下一個合法 Principle ID
- [ ] #2 ONE Golden Master 原則以 Mandatory Architecture Principle 寫入正式治理 Source，且保留 PM 核心語意
- [ ] #3 完成 Existing Principle Conflict Audit；若有衝突需明列 ID、原文、位置與原因
- [ ] #4 完成 AI Board／WorkTodo Golden Master Conformance Audit，不因發現問題而修改 Product Source
- [ ] #5 回報 Principle ID、Primary Source、Registry Source、Conflict、Conformance、Product／Cloud／Schema／RPC／RLS／Migration 變更狀態與 Git 狀態
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit formal Principle Registry, Architecture, Engineering, Governance and ADR sources. 2. Audit numbering conflicts and existing ONE Golden Master wording or consumer presentation exceptions. 3. Write the mandatory principle and required cross-references only in governance documentation. 4. Run documentation/static QA and report conformance findings without product refactor.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Read-only audit 2026-08-21: repository has no AI_RULEBOOK or formal Principle Registry file. Knowledge Center lists KP-001 and ADR-001; Architecture Bible binds ADR-011/012/013. Canonical runtime Principle source is public.engineering_knowledge via resolve_current_engineering_memory, with 22 approved EP principles and max EP-038; no approved Golden Master/presentation duplicate found in Cloud. No authoritative crosswalk or legal next-ID rule was found, and the existing governance-write allowlist does not include engineering_knowledge. Principle Write is BLOCKED pending PM/CTO decision on the canonical numbering/crosswalk and authorized write path. Product/Cloud/Schema/RPC/RLS/Migration unchanged; conformance findings are reported read-only.

PM/CTO Decision 2026-08-21: Principle namespace and ID are explicitly assigned as EP-039; do not infer a successor from EP-038. ADR-011 and ADR-012 receive cross-reference only. EP-039 Principle Write is delegated to TASK-9; no Golden Master Presentation Refactor in this task.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: PM/CTO
created: 2026-08-21 15:08
---
PM/CTO formally assigned EP-039 and required a reusable controlled Principle Write Governance Path before publication.
---
<!-- COMMENTS:END -->
