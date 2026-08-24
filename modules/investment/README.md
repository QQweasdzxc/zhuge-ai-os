# Investment Module

Investment 是 Zhuge AI OS Module 02。目前版本透過 Shared Platform 取得 Identity、Session、Permission、Security、ModuleContext 與 Data Gateway，並以 Supabase Auth UUID 對應 Legacy Investment owner 後讀取真實雲端資料。

## Runtime pages

- 戰情首頁
- Portfolio
- Watchlist
- Strategy
- Settings

## Current data mode

`Supabase Investment Repository`

本版本不連線、不遷移且不修改 Production Database。MFA、Production UUID Migration 與 RLS Integration 留待下一個已授權 Sprint。

## Boundary

Investment 不維護 OAuth、Google Login、Supabase Auth、Session Storage、LocalStorage Identity 或固定使用者。模組只能透過 `ModuleContext` 取得目前 Shared Identity UUID。
