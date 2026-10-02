# Pending Transaction → Portfolio Data Flow

本圖為 source contract tracing；本輪沒有呼叫確認 RPC，也沒有 Cloud/Product Data mutation。

```text
使用者在 Pending Card 按「確認更新」
  │
  ├─ InvestmentModule.confirmPendingAction(actionId)
  │    ├─ 若敏感寫入偏好要求 step-up 且 browser session 非 AAL2
  │    │    └─ Shared MFA prepare → TOTP challenge/enrollment UI
  │    │         └─ verifyUnlock → Supabase Auth challengeAndVerify
  │    │              → sync canonical session → 確認 browser AAL2
  │    └─ 否則進入 submitting（仍不代表 Cloud 一定放行）
  │
  ├─ SupabaseInvestmentRepository.confirmPendingAction(actionId)
  │    ├─ assertSession(write=true): authenticated + AAL2
  │    └─ Shared Gateway RPC: investment_confirm_pending_action(p_action_id)
  │
  ├─ Cloud public.investment_confirm_pending_action(uuid)
  │    ├─ auth.uid 存在
  │    ├─ JWT AAL2 或 private.investment_mfa_bypassed()
  │    ├─ canonical owner mapping + 該 owner 的 pending row
  │    ├─ SELECT ... FOR UPDATE；驗 pending / record_transaction
  │    └─ public.investment_record_transaction(..., pending.idempotency_key)
  │         ├─ owner/portfolio/AAL/payload/idempotency 驗證
  │         └─ INSERT public.transactions（唯一 canonical ledger）
  │
  ├─ 成功時 UPDATE public.investment_pending_actions
  │    └─ status=confirmed, confirmed_at, transaction_id, last_error=null
  │
  └─ 成功後 UI reload
       ├─ investment_current_positions_view 重算持股/平均成本/投入成本/損益
       └─ Investment load 另呼叫 IVTK identity repair / projection sync；
          可能更新 Board 卡片投影，不是財務交易 ledger
```

## 寫入與計算邊界

| 資料 | 成功確認時的行為 |
|---|---|
| `public.transactions` | 新增一筆 canonical 買/賣交易（日期、種類、symbol、quantity、price、gross、fee、tax、net、currency、account、source、note、idempotency key）。 |
| `public.investment_pending_actions` | 將原 pending row 標記為 `confirmed`，寫 `confirmed_at`、`transaction_id`，清空 `last_error`。 |
| `public.opening_positions` / opening baseline | 不會被此 RPC 改寫。 |
| 持股股數 / 平均成本 / 投入成本 | 不另寫一份 portfolio totals；由 `investment_calculated_positions()` 和 `investment_current_positions_view` 依 opening/broker baseline + 啟用後交易計算。買入成本包含費用/稅；賣出依移動加權平均扣減。 |
| 市值 / 未實現損益 | 由計算結果和可用的最新價格衍生；若沒有 last price，市值 / 未實現損益可以是 NULL，不會由確認交易流程補造。 |
| IVTK board projection | 確認成功後的 UI `load()` 會呼叫 `repairIvtkIdentity()` / `syncIvtkProjection()`；該同步屬 Board 卡片/投影 side effect，與 canonical portfolio ledger 分開。 |

## 失敗邊界

- Repository 在 `assertSession({write:true})` 失敗：不呼叫 confirmation RPC。
- Cloud confirmation function 在 AAL2/bypass 檢查失敗：在鎖 pending row 或呼叫 transaction RPC 前拒絕；不會建立 transaction，也不會把 pending 標成 confirmed。
- 若 gate 已通過但後續 payload / transaction validation 失敗，confirmation function 的 exception handler 會在 pending row 記錄 `last_error` 後重新拋錯；這與 AAL gate 早期拒絕不同。
- 本輪只驗 source contract，未 read-back 這四筆 live status；不得將此文件視為某筆交易 Cloud 狀態證明。
