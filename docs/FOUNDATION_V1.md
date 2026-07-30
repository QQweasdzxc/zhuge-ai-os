# Zhuge AI OS Foundation v1.0

## 永久規範

- One Identity：Google Identity 與 Supabase Session 只建立一次。
- One Dashboard：`/` 唯一導向 AI OS 首頁與 Identity Hub。
- One Shared Runtime：Auth、Google、Supabase、API、Theme、Components、i18n 與 Utils 只由 `shared/` 提供。
- Independent Modules：WorkLog、Investment、Travel、HR、Knowledge 各自維護 Business Logic，不互相引用。
- Default Locale：`zh-TW`、`Asia/Taipei`、`yyyy/MM/dd`、`TWD`。

## 模組邊界

```text
app/                  AI OS 首頁、Shell、Root Router
shared/               唯一共用層
modules/worklog/      WorkLog Business Logic、UI、Pages
modules/investment/   Investment 預留模組
modules/travel/       Travel 預留模組
modules/hr/           HR 預留模組
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

## 版本基準

Foundation v1.0 建立於 `0.9.0-alpha.8.4` / `20260730-1135`。
