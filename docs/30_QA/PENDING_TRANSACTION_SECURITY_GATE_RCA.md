# Pending Transaction Security Gate RCA

日期：2026-10-02（Asia/Taipei）  
模式：Source / migration contract 唯讀追查。沒有呼叫確認 RPC，沒有讀取 Cloud 交易列或安全偏好，沒有進行 MFA enrollment/challenge。

## 結論

「額外安全保護」在來源中對應的是 Investment 敏感寫入的 Supabase Auth assurance gate：必須有 authenticated session，交易寫入時需要 JWT `aal2`，或符合受控的 Investment MFA bypass preference。`aal2` 的 step-up 使用 Shared Supabase Auth TOTP factor（UI 稱 Google Authenticator），不是單純登入 session、一般角色判斷或另一組 Investment passcode。

pending action 還會檢查 authenticated portfolio owner mapping 與該 owner 的 pending row；這是資料範圍授權，和 MFA assurance 是不同檢查。

PM 畫面中的「尚未更新／投資資料受到額外安全保護……」與 Repository 的 `INVESTMENT_ASSURANCE_REQUIRED` 文案完全一致。最直接的阻擋點是 `SupabaseInvestmentRepository.assertSession({write:true})` 在 AAL1 時拒絕呼叫；如果前端的敏感寫入偏好略過 preflight、session snapshot 與送出的 JWT assurance 不一致，或 Cloud 返回 403，也會在相同確認流程被拒絕。由於沒有讀取本次實際 session AAL、偏好或 Cloud error payload，不能把其中一種條件冒稱為已在 Cloud 證實的唯一觸發原因。

## Gate 層與來源

| 層 | Source / function | 判斷 |
|---|---|---|
| 確認 UI preflight | `modules/investment/services/investment-module.js`：`currentSessionHasAal2()`、`sensitiveWriteRequiresStepUp()`、`confirmPendingAction()` | 預設 `investment_sensitive_write_mfa_required` 為 true 且 session 不是 AAL2 時，呼叫 `context.security.prepareUnlock()`，只進入 inline step-up，不送確認 RPC。 |
| Repository boundary | `modules/investment/services/supabase-investment-repository.js`：`assertSession({write:true})`、`confirmPendingAction()` | 要 authenticated session；AAL1 write 直接拋 `INVESTMENT_ASSURANCE_REQUIRED`，之後才會呼叫 `gateway.rpc("investment_confirm_pending_action", ...)`。 |
| Shared MFA | `shared/security/mfa-service.js`：`prepare()`、`enroll()`、`verify()` | 列出 Supabase Auth 已驗證 TOTP factor；以 `challengeAndVerify` 驗證 6 位碼並同步 canonical session。沒有獨立 Investment passcode。 |
| Cloud confirmation | `docs/supabase/20260917_investment_pending_action_confirmation_v1.sql`：`public.investment_confirm_pending_action(uuid)` | 檢查 `auth.uid()`，要求 JWT AAL2 或 `private.investment_mfa_bypassed()`；再驗 owner mapping、鎖定 pending row、檢查狀態與 action type。僅授權 authenticated 執行。 |
| Canonical transaction | `docs/supabase/20260915_investment_transaction_lifecycle_v1.sql`：`public.investment_record_transaction(...)` | 再檢查 AAL2 或 bypass、owner/portfolio scope、payload 與 idempotency，才 append canonical transaction。 |

Pending action 的 gate contract 最初可追至 migration `20260917_investment_pending_action_confirmation_v1.sql`；AAL2 / owner MFA policy 在 `20260902_investment_mfa_pause_read_policy.sql`、`20260902173901_investment_two_layer_mfa_contract.sql` 建立/演進。Git blame 對目前 migration source 顯示 commit `90d6cb33fa904e6bc1512c71c59f6438b67e9558`、author `QQweasdzxc`；該提交是 FullSource snapshot，不能單憑它證明是哪位人員作出 PM/product authorization。

### 偏好與 Cloud gate 的注意事項

- UI preflight 讀 `investment_sensitive_write_mfa_required`，缺值預設為 true。
- Cloud `private.investment_mfa_bypassed()` 實際讀 `investment_entry_mfa_required`，並以舊 `investment_mfa_required` 作相容 fallback；它不讀 `investment_sensitive_write_mfa_required`。
- 因此，僅把敏感寫入 UI 偏好設為 false，不等於 Cloud 寫入 gate 也允許 AAL1。Repository comment 亦明示該偏好不會放寬 Cloud RPC gate。
- `role` 不是此交易確認的主要 MFA 判斷；函式同時要求 authenticated user 與 owner mapping / owner-scoped pending row。Creator/Owner 身分另用於管理 MFA preference 的設定能力。

## 正常驗證入口與目前可操作性

預期入口是按下該 pending card 的「確認更新」後，在同一張卡片內完成 TOTP step-up：已有 verified factor 時輸入 6 位碼；沒有 factor 時先開始設定。

但目前存在 setup 呈現斷點：

1. `transactions-page.js` 的 `stepUp()` 有 `enrollment_required` 按鈕分支及 OTP challenge 分支，沒有 `mode === "enroll"` 的 QR / secret 呈現分支。
2. `enrollPendingActionTotp()` 收到 Shared MFA 的 `mode: "enroll"`、`qrCode`、`secret` 後重新 render；pending card renderer 因缺少該分支會落入 OTP challenge markup，使用者看不到掃描 QR 或設定金鑰的入口。
3. 另一個 `investment-module.js` entry unlock screen 有 QR/secret renderer，但它只在進入模組時實際觸發 entry lock 的情況可用；`偏好設定`頁目前沒有獨立 MFA 管理入口。

因此：有已驗證 TOTP factor 時，pending inline challenge 有明確入口；首次設定使用者若只從 pending card 進入，現行 enrollment flow 不完整，不能確認為可完成。這是 UX/runtime contract finding，本輪未修。

## 四筆交易判定

使用者報告畫面中的 2330（買進 1 股）、00878（買進 29 股）、00929（買進 35 股）、0050（買進 28 股）是在 `待我確認` 清單內，且按確認後顯示安全 gate 文案。

若每筆操作都在相同 gate 拒絕，該次操作未完成 canonical transaction insert，也不會走成功 reload；因此該次點擊沒有更新其持股。程式中的 pending list 是 owner-scoped `status=pending` 讀取。惟本輪沒有新做 authenticated Cloud read-back，故不宣稱這四筆目前在 Cloud 的最新狀態、或排除先前其他操作已經寫入；只對使用者描述的失敗點做 source-level RCA。

## Double-apply 防護

- `investment_pending_actions` 有 `(user_id, portfolio_id, idempotency_key)` unique constraint。
- `investment_confirm_pending_action` 對 pending row 使用 `FOR UPDATE`；若已 `confirmed` 且有 `transaction_id`，回傳既有結果而不再記一筆。
- `investment_record_transaction` 先以 owner/portfolio/idempotency key 查既有交易，交易紀錄亦有 unique index；另使用 per-symbol transaction advisory lock。

來源具備重複確認防護；本輪沒有對 Live Cloud 做併發或重送實測，因此只列 source-contract 證據，不宣稱 live Cloud idempotency runtime PASS。

## 建議（不改 gate）

`RECOMMENDED_SIMPLIFICATION`：保留「PM 明確按確認」的人工作業閘門，也保留既有 AAL2/TOTP 安全邊界；不要移除或繞過 MFA。後續若獲准修 UX，將提示寫清楚「為何需要驗證、在此輸入/設定驗證器、成功後會正式登錄該筆交易」，並補上首次 enrollment 的 QR/secret 畫面。額外二次確認 modal 目前沒有明顯必要，因按鈕已是明確確認且仍有 MFA；但是否採用此 UX 建議留 GPT/PM Review。

安全影響：保留目前 Cloud assurance 與 owner gate，不降低安全性。  
重複提交：保留既有 row lock / idempotency；仍需日後 authenticated runtime 驗證。  
Rollback：本輪無交易 mutation，不需資料 rollback；未來若僅調整 UX，可回復 UI source。若日後已確認入帳，不能以刪除/回滾資料方式撤銷，應依 canonical transaction lifecycle 記錄更正交易。
