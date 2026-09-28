---
id: TASK-9
title: >-
  EP-039 Principle Write Governance Path — Controlled Engineering Principle
  Write
status: In Progress
assignee:
  - '@codex'
created_date: '2026-08-21 14:59'
updated_date: '2026-08-21 15:08'
labels:
  - governance
  - engineering-principle
  - security
  - ep-039
dependencies: []
modified_files:
  - >-
    docs/principles/EP-039-one-golden-master-single-presentation-source-of-truth.md
  - docs/supabase/20260821_ep_039_principle_write_governance.sql
  - supabase/functions/engineering-transition/index.ts
  - tools/engineering-governance-write.js
  - tools/pm-governance-approval.js
  - tests/engineering-governance-write.test.js
  - tests/pm-governance-approval.test.js
priority: high
type: enhancement
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
建立可重複使用、受控的 Engineering Principle Write Path，讓正式 Engineering Principle 只能經 PM/QJC authenticated authorization、payload binding、GPT governance-write actor、既有 engineering-transition 與 read-back 寫入 public.engineering_knowledge。不得使用 Direct SQL、Service Role 直寫、一次性後門或第二套 Governance Source。完成後以此 Path 寫入 EP-039。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Only the existing authenticated PM/QJC authorization path can approve a Principle write; anonymous, non-owner and GPT-only issuance are denied.
- [ ] #2 The write operation is explicitly allowlisted, payload-bound, short-lived, one-time, audited and cannot accept arbitrary table or field names.
- [ ] #3 No browser, consumer, Direct SQL or Service Role direct-write path is introduced; existing engineering_knowledge RLS remains enforced.
- [ ] #4 EP-039 can be written and read back from public.engineering_knowledge only through the verified controlled path.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit and preserve the existing PM authorization, actor broker, Edge Function and audit boundaries. 2. Add an explicitly allowlisted, payload-bound Engineering Principle operation through the existing controlled Governance Write path. 3. Add append-only/versioned Principle validation and activity audit without weakening engineering_knowledge RLS. 4. Add contract/security regression tests and document the PM approval and read-back flow. 5. Execute EP-039 only after the controlled path is verified and an authenticated PM/QJC authorization is available.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PM/CTO Decision 2026-08-21: Principle namespace is explicitly EP-###; this task owns the reusable write path before EP-039 publication. Do not start Golden Master Presentation Refactor.

Implementation 2026-08-21: Added bounded create_engineering_principle operation to the existing PM Authorization -> GPT actor -> engineering-transition -> SECURITY DEFINER path. Payload is limited to EP-###, title, summary, content, module, version and provenance; database fixes knowledge_type=principle, status=approved and conflict_status=none; duplicate code is rejected and revision requires a separate PM Decision. Added canonical Startup Gate read-back and governance regression coverage. Cloud DDL migration applied and engineering-transition Edge Function deployed; EP-039 publication remains gated on an authenticated PM/QJC authorization and has not been written yet.
<!-- SECTION:NOTES:END -->
