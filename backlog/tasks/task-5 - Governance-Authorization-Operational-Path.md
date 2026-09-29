---
id: TASK-5
title: Governance Authorization Operational Path
status: In Progress
assignee:
  - '@Co'
created_date: '2026-08-16 14:25'
updated_date: '2026-08-17 00:45'
labels:
  - governance
  - security
  - tooling
dependencies: []
references:
  - tools/engineering-governance-write.js
  - tools/engineering-actor-broker.js
  - docs/supabase/20260814_pm_authorized_governance_write.sql
priority: high
type: enhancement
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
補齊既有 PM/QJC authenticated Governance Authorization 的 operational entry point，不建立第二套 Identity、Authorization、Governance endpoint 或 Canonical Source。沿用 issue_engineering_governance_authorization(jsonb)、engineering-actor-broker.js、engineering-transition 與既有 controlled Governance Write。PM 只審閱 Governance Action 並按核准／拒絕；一次性 authorization 只留在受控本機流程，不進入 Browser UI、Source、localStorage、log 或聊天。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 PM/QJC 可在受控本機 approval page 完成既有 Supabase authenticated Google Login；PM session 不落盤。
- [ ] #2 PM review → approve/reject → existing issue_engineering_governance_authorization → existing GPT governance-write actor → existing engineering-transition → read-back 可連續執行；PM 不接觸任何 token、JSON 或 SQL。
- [ ] #3 Only authenticated owner can complete authorization; anonymous/non-owner receives DENY；拒絕、取消、第二次 click 不產生 Governance Write。
- [ ] #4 PM authorization and GPT actor capabilities are one-time/short-lived/payload-bound；runner 不輸出或保存秘密。
- [ ] #5 Tests verify operation allowlist、payload binding boundary、no browser secret exposure、direct DML/service-role bypass absent。
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a local-only PM approval runner that binds a fixed action manifest to the existing allowlisted Governance operations. 2. Resolve the existing public Supabase URL/anon configuration without duplicating secrets, and load the broker private key only from the protected environment/Keychain at approval time. 3. Implement server-side PKCE Google Login, in-memory session/capability handling, PM review/approve/reject, existing issue_engineering_governance_authorization RPC, existing GPT broker, existing engineering-transition write, and read-back. 4. Add security/contract tests proving no Browser token exposure, no direct DML/service-role path, no replay, payload mutation, anonymous/non-owner denial boundary, and rejection without write. 5. Document the exact local setup and required Supabase redirect allow-list; do not execute Canonical TASK or Checkpoint writes in this task.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-08-16: Local operational path implementation and QA completed. Added localhost-only PM/QJC approval runner, protected environment loader, immutable allowlisted action manifest, existing Supabase PKCE login, owner probe, existing PM issuance RPC, GPT governance-write broker, engineering-transition execution, canonical read-back, and no-secret browser surface. Targeted runner tests: 9 pass. Full suite: 147 pass, 4 browser tests skipped because no browser executable, 0 fail. Live PM OAuth/approval/read-back remains pending exact Supabase redirect allow-list and protected runtime execution.

2026-08-17: Live PM QA initially failed because the inline approval bootstrap script had an unescaped double quote in setChips(), causing SyntaxError and blank action fields. Fixed by using single-quoted HTML fragment, added vm.Script bootstrap syntax regression coverage. Clean browser smoke now renders the immutable action and has no console errors. Full suite: 147 pass, 4 browser tests skipped, 0 fail. Runner restarted at localhost:8765; waiting for PM retest. No Governance Write executed.
<!-- SECTION:NOTES:END -->
