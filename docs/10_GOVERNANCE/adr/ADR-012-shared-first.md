# ADR-012 — Shared First Principle

Status: Accepted
Decision Authority: PM / Architecture Owner
Effective Date: 2026-08-01

## Context

Identity、Google、Supabase、Theme、Router、Storage 與 Security 都是平台能力。若第二個 Module 再建立一份實作，會產生多套 OAuth、Session、權限、樣式與資料存取規則。

## Decision

任何能力只要預期被第二個 Module 使用，就必須先抽成 Shared Contract，再進入 Module Coding。

Shared First 適用範圍至少包含：

- Google Identity 與 Google API。
- Supabase Client、Gateway、Realtime 與 Repository transport。
- Router、Navigation、Workspace lifecycle。
- Theme、Design Token、Shared Component。
- Storage、Cache、Draft 與資料清除規則。
- Security Gate、Permission、Privacy Mode、Auto Lock。
- 共用 Model、Constant、Config、API error contract。

Module 只能保留自己的 Domain Logic。例如 Investment 可保留 Portfolio、Position、Transaction、Watchlist 與投資計算；不得自行初始化 Supabase、建立 OAuth 或管理 Global Session。

## Shared Admission Gate

能力進入 `shared/*` 前必須回答：

1. 是否確實有兩個以上 Module 的使用情境？
2. Contract 是否不含單一 Module 的 Domain 規則？
3. 是否有 owner、測試與版本相容策略？
4. 是否避免建立與現有 Shared Runtime 重複的第二套實作？

若只有單一 Module 使用，應先留在該 Module；不得為想像中的需求過度抽象。

## Consequences

- 平台能力維持 One Identity、One Session、One Gateway、One Theme。
- Shared 變更的影響面較大，必須經 Architecture Review 與 Regression Gate。
- Module 與 Shared 的責任邊界需由 Contract 與測試固定。

## Supported Engineering Principle

`EP-039 — ONE Golden Master — Single Presentation Source of Truth` 是本 ADR
關於「第二個 Consumer 使用的共同能力必須成為 Shared Contract、不得建立
重複 Presentation implementation」的正式 Mandatory Architecture Principle
支持來源。

這裡只建立 cross-reference，不複製 EP-039 內容；EP-039 的 canonical
runtime record 位於 `public.engineering_knowledge`。
