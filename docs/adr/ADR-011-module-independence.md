# ADR-011 — Module Independence Principle

Status: Accepted
Decision Authority: PM / Architecture Owner
Effective Date: 2026-08-01

## Context

Zhuge AI OS 將持續加入 WorkLog、Investment、Travel、HR、Knowledge 等模組。若模組直接引用其他模組，任何單一模組的資料模型、UI 或發佈節奏都會向外擴散，最終形成無法獨立測試、部署及移除的耦合網路。

## Decision

每一個 Module 必須保持獨立：

```text
modules/investment
        ×
modules/worklog
```

唯一允許的跨模組依賴方向是：

```text
modules/*
    ↓
shared/*
```

Module 不得：

- import、讀取或呼叫其他 Module 的程式、DOM、Store、Service、Model 或 Asset。
- 透過全域變數、LocalStorage key、Event 名稱或 Database side effect 建立隱性跨模組相依。
- 直接跳轉到其他 Module 的內部 Route。
- 以複製程式碼規避本規則。

需要跨模組共用的能力，必須先定義為 `shared/*` Contract，再由各 Module 使用。

## Enforcement

- Architecture Review 必須檢查 import graph 與 runtime dependency。
- CI 應加入 Module Boundary Test。
- Root Router／Workspace Manager 負責模組切換；Module 不管理其他 Module。
- 違反本 ADR 的 PR 不得合併。

## Consequences

- Module 可獨立開發、測試、停用與版本化。
- Shared Contract 需要明確的 owner 與相容性規則。
- 跨模組需求可能需要先做 Shared Design Review，但不允許以短期方便破壞邊界。
