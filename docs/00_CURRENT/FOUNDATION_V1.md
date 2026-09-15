# Zhuge AI OS Foundation v1.0

Status: Foundation baseline retained for provenance. Current production sitemap,
Module C contracts, and release identity rules are maintained in
[`ARCHITECTURE.md`](./ARCHITECTURE.md), [`MODULE_SPEC.md`](./MODULE_SPEC.md), and
[`../10_GOVERNANCE/RELEASE.md`](../10_GOVERNANCE/RELEASE.md).

This document is the concise baseline. The detailed contracts live in
[`FOUNDATION.md`](./FOUNDATION.md), [`MODULE_SPEC.md`](./MODULE_SPEC.md),
[`NAMING.md`](./NAMING.md), [`UI_GUIDELINE.md`](./UI_GUIDELINE.md),
[`CODING_STANDARD.md`](../10_GOVERNANCE/CODING_STANDARD.md), and [`RELEASE.md`](../10_GOVERNANCE/RELEASE.md).

## 永久規範

- One Identity：Google Identity 與 Supabase Session 只建立一次。
- One Dashboard：`/` 唯一導向 AI OS 首頁與 Identity Hub。
- One Shared Runtime：Auth、Google、Supabase、API、Theme、Components、i18n 與 Utils 只由 `shared/` 提供。
- Independent Modules：WorkLog、Investment、Travel、HR、Knowledge 各自維護 Business Logic，不互相引用。
- Shared C Runtime：C Mother、AI Board、WorkTodo、GAS、Investment 的 Board
  capability 使用同一份 Module C shared runtime；Consumer data 與 domain
  configuration 保持分離。
- Optional Workflow：Workflow `NOT_CONFIGURED` / `N/A` 是合法能力狀態；不因未設定 Workflow
  自動判定整個 Consumer 失敗。
- C Completion：適用的 Consumer 以實際進入 Completion 的事件開始，使用目前
  `86400` 秒／24 小時的 C Shared Lifecycle；不以建立時間或最後編輯時間起算。
- Default Locale：`zh-TW`、`Asia/Taipei`、`yyyy/MM/dd`、`TWD`。

## 模組邊界

```text
app/                  AI OS 首頁、Shell、Root Router、Board Consumer entries
shared/               唯一共用層與 Module C Board Runtime
modules/worklog/      WorkLog Business Logic、UI、Pages、Knowledge/Management shell
modules/investment/   Investment Domain module
modules/travel/       Travel DEV-ONLY 預留模組
modules/hr/           HR DEV-ONLY 預留模組
```

任何模組只能依賴 `shared/*`，不得 import 其它模組。核心 OAuth、Supabase
Schema 與 WorkLog Business Logic 不因 Foundation 整合而改寫。

## 導航與身分

```text
Landing / Root
   ↓
AI OS 首頁（Identity Hub + AI Daily Brief + 工作模組入口）
   ↓
工作模組
```

工作模組內顯示 `Zhuge AI OS › Module` breadcrumb，讓使用者始終知道目前位置。

## 歷史版本基準

Foundation v1.0 建立於 `0.9.0-alpha.8.4` / `20260731-0905`；這是歷史
Foundation provenance，不是目前 Production 或 Published C identity。
