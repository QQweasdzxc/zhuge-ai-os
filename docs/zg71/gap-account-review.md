# 缺口帳號唯讀性質查證（補充 7，2026-11-09）

只回傳來源描述與彙總計數；沒有 Email、UUID、IP、token 值、名單或資料內容。

## 證據

- `gap-activity-readonly.sql`：由 schema 欄位語意與指向 Auth/App/TF user 的外鍵找出 App 身分欄位，掃描 **158 個 public/TF 欄位來源＋6 個 private App 來源**，各來源對缺口帳號的匹配列數／人數均 **0**。涵蓋 Board/任務、工作紀錄、附件、通知、設備/ERP 操作 audit、TF 使用者/活動/會員/PAT 所有者，以及 private 申請、creator notes、LINE binding。排除獨立學習島資料；不讀 Sheet 業務內容、不從 JSON/文字暱稱猜身分。
- `gap-auth-readonly.sql`：缺口帳號 **1**，provider **Google**，不是 Supabase anonymous；建立與最後登入均在 **1–7 天前**。Auth sessions **3**，not_after 未到期或未設上限 **3**，近 7 天 refreshed_at **0**；未撤銷 refresh token **3**，其更新時間在近 7 天內 **3**（可能是建立時的更新，不代表後續反覆使用）。TF Email 對應計數 **0**；TF UUID 對應亦 **0**。session/refresh-token 列不等於某個已簽發 JWT 現在必定有效，也未核實 Auth 全域期限設定；只能確認這些列尚未標記撤銷／過期。
- 另外只查 server app metadata 的 is_test/test_account 標記是否存在：**0**；deleted account **0**。這兩個常見 server 標記均未出現，不能依 Email／名稱猜測是測試帳號。
- `gap-evidence-counts.json` 保留完整來源及彙總。Auth audit 查詢沒有匹配列；不將這視為「從未登入」證明，因為 audit 保留範圍未核實。

## 結論與固定建議

**未觀測到可驗證的 App 活動，但有近期 Google 登入與未撤銷 refresh token；不能宣稱帳號停用、已無效或肯定為測試／未使用帳號。** 這些資料不足以證明仍在使用 App，也不足以排除未留存的活動。不能把「查不到活動」等同「不會影響任何人」。

目前沒有 App 範圍內既有證據可安全轉換成 membership，因此**不提供也不執行替它補建 membership 的 SQL**；不能拿 Auth 建立時間或 refresh token 當 App 成員證據。先前依賴它下次登入來補證據的啟用前提已撤回。

固定建議：此帳號不納入祖父。migration 單獨部署仍 **6 允許／0 禁止**；main 明確批准並執行 A 後為 **5 允許／1 Off**，既有有 App 證據的 5 人不變。這會撤除 1 人目前因全站暫停而具有的資格；不能因沒有可查 App 活動就隱藏這項實際影響，且其 refresh token 尚未撤銷。啟用不會刪除 Auth 帳號／撤銷 token，但受新 gate 的路徑即使持有效 JWT 仍回 Off。

`activate-cutoff.sql` 固定使用 `select private.activate_app_access_model(1);`，由 main owner-only 操作，**明確確認「1 個未證實身分將失去暫停放行」**；只接受預期彙總數，不接受 UUID 或時間。若 live 缺口數已變動就原子拒絕，避免依舊計數誤啟用。快照仍只取 App 證據來源，絕不把缺口從 Auth 匯入；本 PR 未執行此操作。

本地 PGlite 已測：錯誤的預期數拒絕；明確確認 1 後該未證實帳號直接 Off，不需等待登入；之後 ensure_app_member 也不能回填祖父或自動解除 Off。creator 明確 On 才能允許。六種狀態的 48 組矩陣與回復測試維持。
