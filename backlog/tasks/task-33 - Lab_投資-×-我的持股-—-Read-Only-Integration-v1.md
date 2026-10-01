---
id: TASK-33
title: Lab_投資 × 我的持股 — Read-Only Integration v1
status: In Progress
assignee:
  - '@Co'
created_date: '2026-10-01 15:23'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
在 labs/investment 建立對正式 Investment canonical holdings source 的 authenticated read-only adapter，展示真實持股摘要並能導向 Lab 個股研究。不得修改 modules/investment business logic、持股資料、Cloud/Product Data、Secrets 或 GitHub Remote。缺值保持 null/破折號，不補零；研究資料與 Portfolio source/freshness 分開標示；不以持股推導交易建議。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Lab 從 canonical authenticated Investment holdings source 讀取持股，且不新增第二份可寫 Portfolio SSOT。
- [x] #2 Lab portfolio adapter 僅執行白名單 read/select，無 insert/update/delete/upsert/rpc/write path；權限/Session/MFA 不足時 fail closed。
- [x] #3 缺值不轉成 0；股票市場/持股來源/研究 Provider/freshness 狀態明確分離。
- [ ] #4 0050、實際台股 ETF、實際台股個股、AAPL、NVDA 可由 holdings context 導向研究；無 US provider 時顯示 NOT_CONNECTED，不造資料。
- [x] #5 Desktop/Mobile local Browser journeys 與 full/browser regression 通過；正式 Investment business logic source unchanged。
- [ ] #6 交付整合說明、Data Contract、Runtime Evidence、QA Summary、screenshots 與 FullSource Candidate ZIP/manifest/SHA256；不 push/deploy。
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. 盤點正式持股 view/gateway、Lab session/bootstrap、research route 與 release packaging contract。 2. 在 Lab 新增最小 select-only adapter 與安全授權處理。 3. 加入持股卡、context-aware research routing 與未接 Provider 的 truthful state。 4. 加入 adapter/UI/safety tests、Desktop/Mobile browser QA 與 runtime evidence。 5. 建立 Candidate docs/screenshots，跑 targeted/full/browser gates，commit main，依 canonical packaging contract 產 ZIP/manifest/SHA256；不 deploy、不 push。
<!-- SECTION:PLAN:END -->

## Developer QA Status

- Build `20261001-2324`; working branch `main`; local-only changes.
- Read-only adapter tests: 4/4 PASS; Lab unit suite: 23/23 PASS.
- Full regression with Chrome: 853/853 PASS, 0 skipped; Browser regression: PASS, 0 skipped; Lab E2E: 12/12 PASS.
- Local unauthenticated preview proves `SESSION_REQUIRED` before portfolio SELECT (0 portfolio REST reads). It does not prove actual holdings or actual-holding click-through.
- `#1` and `#4` remain pending authorized authenticated Runtime read-back. `#6` remains pending final Candidate package; authenticated holdings screenshots are unavailable until the Candidate is served in an authorized session.
- No portfolio/Product Data/Supabase mutation, deployment, or GitHub Remote mutation.
- Evidence documents: `labs/investment/docs/portfolio-readonly-v1/`.
