# 缺口帳號唯讀性質查證（補充 7，2026-11-09）

只回傳來源描述與彙總計數；沒有 Email、UUID、IP、token 值、名單或資料內容。

## 證據

- `gap-activity-readonly.sql`：由 schema 欄位語意與指向 Auth/App/TF user 的外鍵找出 App 身分欄位，掃描 **158 個 public/TF 欄位來源＋6 個 private App 來源**，各來源對缺口帳號的匹配列數／人數均 **0**。涵蓋 Board/任務、工作紀錄、附件、通知、設備/ERP 操作 audit、TF 使用者/活動/會員/PAT 所有者，以及 private 申請、creator notes、LINE binding。排除獨立學習島資料；不讀 Sheet 業務內容、不從 JSON/文字暱稱猜身分。
- `gap-auth-readonly.sql`：缺口帳號 **1**，provider **Google**，不是 Supabase anonymous；建立與最後登入均在 **1–7 天前**。Auth sessions **3**，not_after 未到期或未設上限 **3**，近 7 天 refreshed_at **0**；未撤銷 refresh token **3**，其更新時間在近 7 天內 **3**（可能是建立時的更新，不代表後續反覆使用）。TF Email 對應計數 **0**；TF UUID 對應亦 **0**。session/refresh-token 列不等於某個已簽發 JWT 現在必定有效，也未核實 Auth 全域期限設定；只能確認這些列尚未標記撤銷／過期。
- 另外只查 server app metadata 的 is_test/test_account 標記是否存在：**0**；deleted account **0**。這兩個常見 server 標記均未出現，不能依 Email／名稱猜測是測試帳號。
- `gap-evidence-counts.json` 保留完整來源及彙總。Auth audit 查詢沒有匹配列；不將這視為「從未登入」證明，因為 audit 保留範圍未核實。

## 結論與固定建議

**未觀測到可驗證的 App 活動，但有近期 Google 登入與未撤銷 refresh token；不能宣稱帳號停用、已無效或肯定為測試／未使用帳號。** 這些資料不足以證明仍在使用 App，也不足以排除未留存的活動。不能把「查不到活動」等同「不會影響任何人」。

目前沒有 App 範圍內既有證據可安全轉換成 membership，因此**不提供也不執行替它補建 membership 的 SQL**，也不建立名片；不能拿 Auth 建立時間或 refresh token 當 App 成員證據。不依賴它下次登入。

固定建議：不判定此帳號是否屬於 App，也不讓啟用改變其現行存取。啟用時凍結「當下有效允許」的 6 人（含此帳號），啟用後為 **6 允許／0 Off**；migration 單獨部署也是 6／0。凍結只保存在內部 private 表，不建立 membership／名片。

`activate-cutoff.sql` 固定使用 `select private.activate_app_access_model(6);`，由 main owner-only 操作；整數為核對過的當下有效允許人數（防漂移），不接受 UUID 或時間。函式在資料庫內讀取身分集合（不傳回身分、不建立名片），只回傳計數，人數不符整筆拒絕。啟用後新進入者不在集合內，為待審／Off；明確 Off 永遠優先。未證實身分仍受限於暫停保持 true；若日後關閉暫停，凍結者需有明確 On。

本地 PGlite 已測：錯誤人數拒絕且不留 cutoff；啟用後現行有效允許全數不變（僅刻意標到 cutoff 之後的夾具事件可變）；該未證實帳號 ensure_app_member 後仍允許；啟用後新建身分為 Off，首次登入仍 Off；明確 Off 優先；重複啟用被拒；server 預設事件時間晚於 cutoff。六種狀態的 48 組矩陣與回復測試維持。真正併發（兩個連線）未在 PGlite 單連線測，鎖序為讀碼與文件，未對正式庫驗證。
