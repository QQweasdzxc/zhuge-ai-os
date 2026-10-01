---
id: TASK-32
title: Lab_投資 — Zhuge Investment Sandbox v1
status: In Progress
assignee: []
created_date: '2026-10-01 08:09'
updated_date: '2026-10-01 08:46'
labels:
  - lab
  - investment
  - local-only
dependencies: []
modified_files:
  - labs/registry.json
  - modules/labs/labs-center.js
  - tests/lab-architecture.test.js
priority: high
type: feature
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
建立 Zhuge-owned、與 Genspark upstream 與正式 AIOS Investment 隔離的本機研究 Lab。以既有 Zhuge Investment Intelligence Lab 的官方資料 adapter / evidence contract 為參考，不搬用 Genspark app source 或 UI。提供 Lab Center 的「Lab_投資 → 進入 Lab」入口、可一鍵啟動的本機體驗、台灣繁體中文的研究工作台與明確 Data Truth 狀態。所有 provider 缺資料、credential、權限或不可用時 fail-closed，不以 simulated/fallback 冒充真實資料。GitHub Remote read-only；不得 push/PR/merge/deploy。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Genspark upstream-original 與 working-copy 均未被修改；新 Sandbox 為 Zhuge-owned、獨立 source/runtime。
- [ ] #2 Lab Center registry 有單一 Lab_投資入口，顯示「進入 Lab」；UI 不把 localhost URL 或終端命令當產品概念。
- [ ] #3 2330、0050、6488 均可開啟研究頁；每個資料欄位顯示實際 provider/status/freshness，未接資料明確標示，不出現假 Runtime value。
- [ ] #4 候選卡、觀察、筆記、開盤壓力、大盤脈搏、技術指標、新聞與產業 Price Radar 均可進入，provider/data limitation 明確可見。
- [ ] #5 無 Demo/VIP/License/Expiry/upstream verify gate；第三方 provider credential、方案、權限與 rate limit 不繞過。
- [ ] #6 Developer QA 覆蓋 targeted、Browser/local runtime、data truth/no-lock/error/stale/unavailable、syntax、diff-check；產出全部指定文件與 screenshots/。
- [ ] #7 正式 AIOS Investment/business modules、Genspark originals、Cloud/Product Data、GitHub remote 均未修改。
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit local repository instructions, task state, Lab registry/launcher, Genspark original/working copy, existing Investment Intelligence provider/evidence source; record hashes and protected boundaries. 2. Create isolated local Git repository at zhuge-labs/investment/zhuge-investment-sandbox on branch lab/investment-sandbox-v1; implement an independent Zhuge-owned local runtime and provider/data-truth contracts using only verified/official adapters or explicit NOT_CONNECTED states. 3. Add the minimal AIOS Lab Center registry/entry and a one-click local launcher on a separate local-only AIOS task branch/worktree, without changing formal Investment or bundling Lab source. 4. Build/verify the requested cards, research views, market/opening-pressure summaries, indicators, news and price radar, with safe empty/unavailable states and no simulated runtime claims. 5. Run targeted tests, browser/runtime journeys, data-truth/no-lock checks, syntax and diff checks; capture screenshots and required deliverables. 6. Package local-only evidence/ZIP if all applicable gates pass; stop for GPT/PM review with any provider/runtime limits stated truthfully.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Developer closure 2026-10-01: Sandbox local commit 6807ad56be3745bca79c7301d02b5b27b57dd432 on lab/investment-sandbox-v1. QA: Sandbox syntax PASS, 13/13 unit/regression PASS, Playwright 11/11 PASS with zero skips/errors, AIOS Lab Center 3/3 PASS, host guard 403, POST guard 405, Info.plist valid, app executable permission PASS. One-click app launched after foreground server was stopped and started a fresh READY loopback runtime. Runtime/provider facts and screenshots are in the Sandbox deliverables. Genspark upstream-original and working-copy stayed clean at 35182db578b0b8c693d34f52f3988534d4c52f83. No remote mutation, deploy, Cloud/Product Data write, credential access, or production Investment change. Awaiting GPT Review and PM Experience Review; TASK remains In Progress.

AIOS local integration commit: fd89fca4ea0d9359c37e1f69eaedb38902776361 on lab/investment-sandbox-v1; includes only the Lab registry, Lab Center entry, focused test, and this TASK-32 sidecar. Remote origin was not contacted or mutated.
<!-- SECTION:NOTES:END -->
