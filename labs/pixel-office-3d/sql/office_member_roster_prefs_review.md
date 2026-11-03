# 成員外觀偏好（prefs）審查

每位家庭成員可選 3D 外觀：自動／女性／男性。偏好儲存在既有 `office_member_roster` 同一筆帳號私密列的 `prefs jsonb` 欄位，不新增資料表、不新增 grant 或 policy——既有 owner-only RLS 直接涵蓋此欄位。未登入時選擇器停用。外觀於下次重新整理後套用，不影響名單內容、同步邏輯或樂觀並行控制。

## 範圍

- 只新增 `prefs` 欄位與 `jsonb_typeof(prefs) = 'object'` 檢查約束；預設 `{}` 即全員「自動」。
- 不動 `third_party/multica`、不遷移其他資料、不新增付費服務、不直接推 main。
- 前端 `members.js` 沿用既有 save 序列化與 `updated_at` 樂觀並行；無效值（非 female/male）在前端被拒絕，後端以 object 型別約束兜底。
- 外觀不含任何真實個資；偏好 key 為名單內的名字，與名單同等級隱私，僅本人可讀寫。

## Migration / Postflight / Rollback

- Migration: `supabase/migrations/20261103130000_office_member_roster_prefs.sql`
- Postflight: `labs/pixel-office-3d/sql/office_member_roster_prefs_postflight.sql`（只輸出欄位結構，不輸出偏好內容）
- Rollback: `labs/pixel-office-3d/sql/office_member_roster_prefs_rollback.sql`（破壞性，需另行核准）

前端使用 authenticated PostgREST + RLS；僅部署程式碼不會套用 SQL，需經另行核准的資料庫部署流程。
