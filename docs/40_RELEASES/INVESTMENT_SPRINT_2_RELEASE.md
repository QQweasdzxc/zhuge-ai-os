# Sprint 2 — Investment Workspace Integration

- Version: `0.9.0-alpha.9.0`
- Build: `20260801-2359`
- Package time: `2026/08/01 23:59 Asia/Taipei`

## Completed

- Investment 正式成為 Zhuge AI OS Module 02。
- Dashboard 提供 Investment 入口。
- Shared Identity、Session、Permission、Security 與 ModuleContext 完成 Runtime 串接。
- Overview、Portfolio、Watchlist、Strategy、Settings 可正常切換。
- Portfolio、Position、Transaction、Watchlist、Strategy、Settings 使用 UUID-scoped Mock Repository。
- Portfolio Calculation Engine 保留 TWD / USD 分離計算與台灣損益色彩語意。

## Non-impact statement

- OAuth：No change
- Google Login：No change
- Production Supabase schema：No change
- Production RLS / RPC / View：No change
- WorkLog business logic：No change
- Root Router：No change

## Known limitations

- Investment 目前為 SIT Mock Data，尚未連線 Production Database。
- MFA、Production UUID Migration 與 Database RLS 留待下一個 Sprint。
- Mock Data 僅用於驗證 Runtime 與 Shared Platform Integration，不代表真實投資資料。

## PM Acceptance

建議驗收順序：

1. 登入 Zhuge AI OS。
2. 從 Dashboard 點選 Investment。
3. 確認右上角顯示登入者，Settings 顯示 Shared UUID。
4. 依序切換戰情首頁、Portfolio、Watchlist、Strategy、Settings。
5. 確認頁面顯示 Mock Repository 且 Production Database 未連線。
6. 返回 Dashboard，再進入 WorkLog，確認既有功能不受影響。

預估驗收時間：10–15 分鐘。
