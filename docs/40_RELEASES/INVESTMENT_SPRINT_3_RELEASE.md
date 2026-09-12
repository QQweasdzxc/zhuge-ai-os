# Sprint 3 — Investment SIT Release

- Product Version: `0.9.0-alpha.9.1`
- Product Build: `20260802-1005`
- Investment Module: `0.2.0-sit.2`
- Database Migration: `sprint_3_investment_aal2_legacy_rls`
- Environment: `SIT / GitHub Pages`

## 本次交付

- Investment 停止使用 Mock Repository，改由 Shared Data Gateway 讀取 Supabase 真實資料。
- PM Supabase Auth UUID 透過 `app_users.auth_user_id` 對應既有 Investment owner，不複製資料。
- 九張 Investment 舊表改為 AAL2、owner-isolated、authenticated read-only RLS。
- 第一次開啟 Investment 必須設定 Google Authenticator；驗證成功後解鎖 10 分鐘。
- Shared MFA Provider contract 已預留 Email OTP 與 Passkey，Sprint 3 不啟用。
- Investment 使用者介面全面改為繁體中文，首頁移除工程資訊。
- Dashboard 帳號區顯示 Google 姓名與 Email，提供 Google 帳號、設定與登出選單，不顯示 UUID。
- WorkLog 工作描述限制為 50 字元，新增即時字數顯示與儲存驗證。

## 資料庫驗證

| Session | 可見 Investment Records |
|---|---:|
| AAL1 | 0 |
| AAL2 + PM Legacy Mapping | Portfolio 1 / Position 8 / Transaction 3 |

Watchlist 與 Strategy 目前各為 0 筆，介面會顯示正常空白狀態。

## 不受影響

- Google OAuth sign-in flow：未修改
- Supabase project/client identity：未修改
- Root Router：未修改
- WorkLog Database Schema：未修改
- WorkLog 功能：除 PM 指定的工作描述 50 字限制外未修改

## 已知限制

- Sprint 3 Investment 為真實資料唯讀 SIT；新增、編輯、交易寫入不在本次範圍。
- PM 第一次驗收需用 Google Authenticator 完成 TOTP enrollment。
- Supabase Advisor 所列舊 Investment SECURITY DEFINER Views 不被本次 Runtime 使用，保留後續資料庫治理處理。
