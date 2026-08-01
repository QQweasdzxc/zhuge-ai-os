# Investment Module

Investment 是 Zhuge AI OS Module 02。目前版本為 SIT Runtime，使用 Shared Platform 提供的 Identity、Session、Permission、Security 與 ModuleContext，並以 UUID 範圍內的 Mock Repository 驗證執行流程。

## Runtime pages

- 戰情首頁
- Portfolio
- Watchlist
- Strategy
- Settings

## Current data mode

`Mock Repository`

本版本不連線、不遷移且不修改 Production Database。MFA、Production UUID Migration 與 RLS Integration 留待下一個已授權 Sprint。

## Boundary

Investment 不維護 OAuth、Google Login、Supabase Auth、Session Storage、LocalStorage Identity 或固定使用者。模組只能透過 `ModuleContext` 取得目前 Shared Identity UUID。

