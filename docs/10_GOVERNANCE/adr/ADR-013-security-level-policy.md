# ADR-013 — Security Level Policy

Status: Accepted
Decision Authority: PM / Architecture Owner
Effective Date: 2026-08-01

## Context

不同 Module 處理的資料敏感度不同。若各 Module 自行決定登入、鎖定、遮罩或權限規則，Security Policy 會分裂且難以稽核。

## Decision

安全等級由 Shared Security Gate 集中管理。Module 可以宣告自己的識別資訊，但不得降低、覆寫或自行實作安全等級。

| Level | Module | Baseline |
| --- | --- | --- |
| Level 1 | Dashboard | 有效 Shared Session；僅顯示目前使用者可存取的入口與非敏感摘要 |
| Level 2 | WorkLog | Level 1 + Auth UUID 資料隔離 + Cloud data ownership enforcement |
| Level 3 | Investment | Level 2 + Privacy Mode + Auto Lock + 敏感操作 assurance policy；正式啟用前完成 RLS/RPC/View 隔離 |
| Level 4 | HR | Level 3 + role/capability authorization + 最小權限 + 敏感資料稽核策略 |

公開 Landing Page 不屬於 Module Security Level，也不得取得受保護的使用者資料。

## Enforcement Model

```text
Root Router
    ↓
Shared Security Gate
    ├─ Session validity
    ├─ Security level
    ├─ Permission / capability
    ├─ Auto Lock / re-auth policy
    └─ Privacy state
    ↓
Module mount
```

- Canonical level mapping 由 Shared Security Policy 持有。
- Module 不能自行建立 OAuth、MFA timer、Session 或 Auto Lock timer。
- Security Gate deny by default；未知 Module 不得 mount。
- Level 3/4 的具體 MFA 或 re-auth 方式須另經 Security Design Review，ADR 本身不授權 Coding。
- Database RLS、View、RPC 與 grants 必須與 Security Level 一致；前端 Gate 不能取代 Database authorization。

## Consequences

- Security Policy 可集中稽核、測試與提升。
- 高等級 Module 可重用同一套 Security Gate。
- Investment 在目前 Gate 1 發現的寬鬆 RLS、Security Definer View 與 Legacy UUID 尚未處理前，不得進入 Runtime Integration。
